import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const STATE_FILE = path.join(DATA_DIR, "app-data.json");
const SECRET_FILE = path.join(DATA_DIR, "server-secret.json");

const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE = "logicachat_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const MAX_BODY_BYTES = 48 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_IMAGE_REFERENCES = 3;
const BOOTSTRAP_OPENAI_KEY = process.env.BOOTSTRAP_OPENAI_KEY?.trim() || "";
const ADMIN_USERNAME = "ramoscv";
const ADMIN_PASSWORD = "Logica!1";
const MODES = ["assistant", "code", "image"];
const REQUEST_MODES = ["auto", ...MODES];
const IMAGE_EDIT_INTENT_PATTERNS = [
  /\bedita(?:r)?\b/,
  /\bedit\b/,
  /\baltera(?:r)?\b/,
  /\bretoca(?:r)?\b/,
  /\bmelhora(?:r)?\b/,
  /\bremove(?:r)?\b/,
  /\bsubstitui(?:r)?\b/,
  /\btroca(?:r)?\b/,
  /\bultima\s+imagem\b/,
  /\bultimo\s+render\b/,
];

const DEFAULT_SETTINGS = {
  assistantName: "Private ChatGPT Pro",
  defaultModel: "gpt-5.5",
  codeModel: "gpt-5.5",
  imageOutputModel: "dall-e-3",
  systemPrompt:
    "You are a precise, helpful, production-grade assistant. Respond clearly, structure complex answers well, and stay practical.",
  codeSystemPrompt:
    "You are a senior software engineer. Produce production-ready code, explain tradeoffs briefly, and when the user supplies a screenshot or image, you can recreate the UI in semantic, accessible, responsive HTML and CSS without unnecessary frameworks unless asked.",
  imageSystemPrompt:
    "Generate or edit highly realistic, polished images by default unless the user explicitly asks for another style. Preserve important identity, composition, and product details when editing reference images.",
  reasoningEffort: "medium",
  maxOutputTokens: 4000,
  imageSize: "1024x1024",
  imageQuality: "hd",
  openAiApiKeyEncrypted: null,
  updatedAt: new Date().toISOString(),
};

const sessions = new Map();
let saveQueue = Promise.resolve();
let serverSecrets = null;
let appState = null;

await bootstrap();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const method = req.method || "GET";

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url, method);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error("Unexpected server error", error);
    sendJson(res, error?.statusCode || 500, {
      error: error?.message || "Erro interno do servidor.",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Private ChatGPT Pro a correr em http://localhost:${PORT}`);
});

async function bootstrap() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  serverSecrets = await loadOrCreateSecrets();
  appState = await loadOrCreateState();

  const changed = normalizeStateShape(appState);
  await ensureDefaultAdmin();
  if (changed) {
    await persistState();
  }
}

async function loadOrCreateSecrets() {
  try {
    return JSON.parse(await fs.readFile(SECRET_FILE, "utf8"));
  } catch {
    const secrets = {
      encryptionKey: crypto.randomBytes(32).toString("base64"),
      cookieSecret: crypto.randomBytes(32).toString("base64"),
    };
    await fs.writeFile(SECRET_FILE, JSON.stringify(secrets, null, 2), "utf8");
    return secrets;
  }
}

async function loadOrCreateState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
  } catch {
    const now = new Date().toISOString();
    const settings = {
      ...DEFAULT_SETTINGS,
      openAiApiKeyEncrypted: BOOTSTRAP_OPENAI_KEY ? encryptSecret(BOOTSTRAP_OPENAI_KEY) : null,
      updatedAt: now,
    };

    const initialState = {
      version: 2,
      settings,
      users: [
        {
          id: crypto.randomUUID(),
          username: ADMIN_USERNAME,
          displayName: "Ramos CV",
          passwordHash: hashPassword(ADMIN_PASSWORD),
          role: "admin",
          isSuperAdmin: true,
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      chats: [],
      messages: [],
    };

    await fs.writeFile(STATE_FILE, JSON.stringify(initialState, null, 2), "utf8");
    return initialState;
  }
}

function normalizeStateShape(state) {
  let changed = false;

  if (typeof state.version !== "number" || state.version < 2) {
    state.version = 2;
    changed = true;
  }

  if (!state.settings || typeof state.settings !== "object") {
    state.settings = { ...DEFAULT_SETTINGS };
    changed = true;
  }

  const mergedSettings = {
    ...DEFAULT_SETTINGS,
    ...state.settings,
  };

  if (!state.settings.codeModel) {
    mergedSettings.codeModel = DEFAULT_SETTINGS.codeModel;
    changed = true;
  }

  if (!state.settings.imageOutputModel) {
    mergedSettings.imageOutputModel = DEFAULT_SETTINGS.imageOutputModel;
    changed = true;
  }

  if (!state.settings.imageSize) {
    mergedSettings.imageSize = DEFAULT_SETTINGS.imageSize;
    changed = true;
  }

  if (!state.settings.imageQuality) {
    mergedSettings.imageQuality = DEFAULT_SETTINGS.imageQuality;
    changed = true;
  }

  if (!state.settings.codeSystemPrompt) {
    mergedSettings.codeSystemPrompt = DEFAULT_SETTINGS.codeSystemPrompt;
    changed = true;
  }

  if (!state.settings.imageSystemPrompt) {
    mergedSettings.imageSystemPrompt = DEFAULT_SETTINGS.imageSystemPrompt;
    changed = true;
  }

  const normalizedImageOutputModel = normalizeImageModelIdentifier(mergedSettings.imageOutputModel);
  if (mergedSettings.imageOutputModel !== normalizedImageOutputModel) {
    mergedSettings.imageOutputModel = normalizedImageOutputModel;
    changed = true;
  }

  const normalizedImageSize = normalizeImageSizeForModel(
    mergedSettings.imageSize,
    mergedSettings.imageOutputModel,
  );
  if (mergedSettings.imageSize !== normalizedImageSize) {
    mergedSettings.imageSize = normalizedImageSize;
    changed = true;
  }

  const normalizedImageQuality = normalizeImageQualityForModel(
    mergedSettings.imageQuality,
    mergedSettings.imageOutputModel,
  );
  if (mergedSettings.imageQuality !== normalizedImageQuality) {
    mergedSettings.imageQuality = normalizedImageQuality;
    changed = true;
  }

  if (mergedSettings.assistantName === "Logic Chat") {
    mergedSettings.assistantName = DEFAULT_SETTINGS.assistantName;
    changed = true;
  }

  if (mergedSettings.defaultModel === "gpt-5.3-chat-latest") {
    mergedSettings.defaultModel = DEFAULT_SETTINGS.defaultModel;
    changed = true;
  }

  if (typeof mergedSettings.maxOutputTokens !== "number") {
    mergedSettings.maxOutputTokens = DEFAULT_SETTINGS.maxOutputTokens;
    changed = true;
  }

  state.settings = mergedSettings;

  state.chats = Array.isArray(state.chats) ? state.chats : [];
  state.messages = Array.isArray(state.messages) ? state.messages : [];
  state.users = Array.isArray(state.users) ? state.users : [];

  for (const chat of state.chats) {
    const currentMemory = chat.responseMemory || {};
    const nextMemory = {
      assistant: currentMemory.assistant || chat.previousResponseId || null,
      code: currentMemory.code || null,
    };

    if (JSON.stringify(currentMemory) !== JSON.stringify(nextMemory)) {
      chat.responseMemory = nextMemory;
      changed = true;
    }

    if (!chat.createdAt) {
      chat.createdAt = new Date().toISOString();
      changed = true;
    }
    if (!chat.updatedAt) {
      chat.updatedAt = chat.createdAt;
      changed = true;
    }
  }

  for (const message of state.messages) {
    if (!message.mode || !MODES.includes(message.mode)) {
      message.mode = "assistant";
      changed = true;
    }

    if (!Array.isArray(message.attachments)) {
      message.attachments = [];
      changed = true;
    }

    if (!message.status) {
      message.status = "sent";
      changed = true;
    }
  }

  return changed;
}

async function ensureDefaultAdmin() {
  let admin = appState.users.find((user) => user.username === ADMIN_USERNAME);
  if (!admin) {
    const now = new Date().toISOString();
    admin = {
      id: crypto.randomUUID(),
      username: ADMIN_USERNAME,
      displayName: "Ramos CV",
      passwordHash: hashPassword(ADMIN_PASSWORD),
      role: "admin",
      isSuperAdmin: true,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    appState.users.push(admin);
    await persistState();
    return;
  }

  if (!admin.isSuperAdmin || admin.role !== "admin" || !admin.active) {
    admin.isSuperAdmin = true;
    admin.role = "admin";
    admin.active = true;
    admin.updatedAt = new Date().toISOString();
    await persistState();
  }
}

async function handleApi(req, res, url, method) {
  if (url.pathname === "/api/me" && method === "GET") {
    const user = getCurrentUser(req);
    sendJson(res, 200, {
      authenticated: Boolean(user),
      user: user ? serializeUser(user) : null,
      appConfig: serializePublicAppConfig(),
    });
    return;
  }

  if (url.pathname === "/api/auth/login" && method === "POST") {
    const body = await readJsonBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = appState.users.find((entry) => entry.username.toLowerCase() === username);

    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      sendJson(res, 401, { error: "Utilizador ou palavra-passe invalidos." });
      return;
    }

    const sessionToken = createSession(user.id);
    setSessionCookie(res, sessionToken);
    sendJson(res, 200, {
      user: serializeUser(user),
      appConfig: serializePublicAppConfig(),
    });
    return;
  }

  if (url.pathname === "/api/auth/logout" && method === "POST") {
    destroySession(req);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  if (url.pathname === "/api/chats" && method === "GET") {
    sendJson(res, 200, {
      chats: listChatsForUser(user.id),
    });
    return;
  }

  if (url.pathname === "/api/chats" && method === "POST") {
    const body = await readJsonBody(req);
    const title = String(body.title || "").trim();
    const now = new Date().toISOString();
    const chat = {
      id: crypto.randomUUID(),
      userId: user.id,
      title: title || "Nova conversa",
      responseMemory: {
        assistant: null,
        code: null,
      },
      createdAt: now,
      updatedAt: now,
    };
    appState.chats.push(chat);
    await persistState();
    sendJson(res, 201, { chat: serializeChat(chat) });
    return;
  }

  const chatMessagesMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
  if (chatMessagesMatch && method === "GET") {
    const chat = getChatForUser(chatMessagesMatch[1], user.id);
    if (!chat) {
      sendJson(res, 404, { error: "Conversa nao encontrada." });
      return;
    }

    sendJson(res, 200, {
      chat: serializeChat(chat),
      messages: listMessagesForChat(chat.id),
    });
    return;
  }

  if (chatMessagesMatch && method === "POST") {
    const chat = getChatForUser(chatMessagesMatch[1], user.id);
    if (!chat) {
      sendJson(res, 404, { error: "Conversa nao encontrada." });
      return;
    }

    const body = await readJsonBody(req);
    const requestedMode = normalizeRequestedMode(body.mode);
    const text = String(body.text || "").trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const mode = resolveEffectiveMode(requestedMode, text, attachments);

    if (!text && attachments.length === 0) {
      sendJson(res, 400, { error: "Escreve uma mensagem ou adiciona um anexo." });
      return;
    }

    if (attachments.length > MAX_ATTACHMENTS) {
      sendJson(res, 400, {
        error: `Podes enviar ate ${MAX_ATTACHMENTS} anexos por mensagem.`,
      });
      return;
    }

    const storedAttachments = await saveIncomingAttachments(chat.id, attachments);
    const now = new Date().toISOString();
    const userMessage = {
      id: crypto.randomUUID(),
      chatId: chat.id,
      role: "user",
      mode,
      text,
      attachments: storedAttachments,
      status: "sent",
      createdAt: now,
      model: null,
      responseId: null,
      usage: null,
    };

    appState.messages.push(userMessage);
    chat.updatedAt = now;
    if (chat.title === "Nova conversa") {
      chat.title = buildChatTitle(text, mode);
    }

    let assistantMessage = null;
    let warning = null;

    try {
      const completion =
        mode === "image"
          ? await requestImageResponse({ user, chat, text, attachments })
          : await requestTextResponse({ user, chat, text, attachments, mode });

      assistantMessage = {
        id: crypto.randomUUID(),
        chatId: chat.id,
        role: "assistant",
        mode,
        text: completion.text,
        attachments: completion.attachments || [],
        status: "sent",
        createdAt: new Date().toISOString(),
        model: completion.model,
        responseId: completion.responseId || null,
        usage: completion.usage || null,
      };

      if (mode !== "image" && completion.responseId) {
        chat.responseMemory = chat.responseMemory || { assistant: null, code: null };
        chat.responseMemory[mode] = completion.responseId;
      }

      chat.updatedAt = assistantMessage.createdAt;
      appState.messages.push(assistantMessage);
    } catch (error) {
      warning = error.message || "Falha ao contactar a OpenAI.";
      assistantMessage = {
        id: crypto.randomUUID(),
        chatId: chat.id,
        role: "assistant",
        mode,
        text:
          "Nao foi possivel concluir este pedido agora. Verifica a chave OpenAI, o modelo configurado e os limites disponiveis para esta funcionalidade.",
        attachments: [],
        status: "failed",
        createdAt: new Date().toISOString(),
        model: selectModelForMode(mode),
        responseId: null,
        usage: null,
      };
      chat.updatedAt = assistantMessage.createdAt;
      appState.messages.push(assistantMessage);
    }

    await persistState();
    sendJson(res, 200, {
      chat: serializeChat(chat),
      userMessage: serializeMessage(userMessage),
      assistantMessage: serializeMessage(assistantMessage),
      warning,
    });
    return;
  }

  const chatMatch = url.pathname.match(/^\/api\/chats\/([^/]+)$/);
  if (chatMatch && method === "DELETE") {
    const chat = getChatForUser(chatMatch[1], user.id);
    if (!chat) {
      sendJson(res, 404, { error: "Conversa nao encontrada." });
      return;
    }

    await deleteChat(chat.id);
    sendJson(res, 200, { ok: true });
    return;
  }

  const attachmentMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)$/);
  if (attachmentMatch && method === "GET") {
    const attachment = await findAttachmentForUser(attachmentMatch[1], user.id);
    if (!attachment) {
      sendJson(res, 404, { error: "Anexo nao encontrado." });
      return;
    }

    const attachmentPath = path.join(DATA_DIR, attachment.relativePath);
    const fileBuffer = await fs.readFile(attachmentPath);
    res.writeHead(200, {
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Length": fileBuffer.length,
      "Content-Disposition": `inline; filename="${attachment.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    });
    res.end(fileBuffer);
    return;
  }

  if (url.pathname === "/api/settings" && method === "GET") {
    if (!canAccessSettings(user)) {
      sendJson(res, 403, { error: "Acesso reservado ao administrador principal." });
      return;
    }

    sendJson(res, 200, {
      settings: serializeSettings(),
    });
    return;
  }

  if (url.pathname === "/api/settings" && method === "PUT") {
    if (!canAccessSettings(user)) {
      sendJson(res, 403, { error: "Acesso reservado ao administrador principal." });
      return;
    }

    const body = await readJsonBody(req);
    const incomingApiKey = String(body.openAiApiKey || "").trim();
    const nextImageOutputModel =
      normalizeImageModelIdentifier(body.imageOutputModel) ||
      normalizeImageModelIdentifier(appState.settings.imageOutputModel);
    const nextSettings = {
      assistantName: String(body.assistantName || "").trim() || appState.settings.assistantName,
      defaultModel: String(body.defaultModel || "").trim() || appState.settings.defaultModel,
      codeModel: String(body.codeModel || "").trim() || appState.settings.codeModel,
      imageOutputModel: nextImageOutputModel,
      systemPrompt:
        String(body.systemPrompt || "").trim() || appState.settings.systemPrompt,
      codeSystemPrompt:
        String(body.codeSystemPrompt || "").trim() || appState.settings.codeSystemPrompt,
      imageSystemPrompt:
        String(body.imageSystemPrompt || "").trim() || appState.settings.imageSystemPrompt,
      reasoningEffort: validateReasoningEffort(body.reasoningEffort),
      maxOutputTokens: validateMaxOutputTokens(body.maxOutputTokens),
      imageSize: normalizeImageSizeForModel(
        String(body.imageSize || "").trim() || appState.settings.imageSize,
        nextImageOutputModel,
      ),
      imageQuality: normalizeImageQualityForModel(
        String(body.imageQuality || "").trim() || appState.settings.imageQuality,
        nextImageOutputModel,
      ),
      updatedAt: new Date().toISOString(),
    };

    appState.settings = {
      ...appState.settings,
      ...nextSettings,
    };

    if (incomingApiKey) {
      appState.settings.openAiApiKeyEncrypted = encryptSecret(incomingApiKey);
    }

    await persistState();
    sendJson(res, 200, {
      settings: serializeSettings(),
    });
    return;
  }

  if (url.pathname === "/api/users" && method === "GET") {
    if (!canAccessSettings(user)) {
      sendJson(res, 403, { error: "Acesso reservado ao administrador principal." });
      return;
    }
    sendJson(res, 200, {
      users: appState.users.map(serializeManagedUser),
    });
    return;
  }

  if (url.pathname === "/api/users" && method === "POST") {
    if (!canAccessSettings(user)) {
      sendJson(res, 403, { error: "Acesso reservado ao administrador principal." });
      return;
    }

    const body = await readJsonBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const displayName = String(body.displayName || "").trim();
    const password = String(body.password || "");

    if (!username || !displayName || !password) {
      sendJson(res, 400, { error: "Nome, utilizador e palavra-passe sao obrigatorios." });
      return;
    }

    if (!/^[a-z0-9._-]{3,30}$/i.test(username)) {
      sendJson(res, 400, {
        error:
          "O utilizador deve ter entre 3 e 30 caracteres e usar apenas letras, numeros, ponto, underscore ou hifen.",
      });
      return;
    }

    if (appState.users.some((entry) => entry.username.toLowerCase() === username)) {
      sendJson(res, 409, { error: "Ja existe um utilizador com esse identificador." });
      return;
    }

    const now = new Date().toISOString();
    const newUser = {
      id: crypto.randomUUID(),
      username,
      displayName,
      passwordHash: hashPassword(password),
      role: "member",
      isSuperAdmin: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    appState.users.push(newUser);
    await persistState();
    sendJson(res, 201, { user: serializeManagedUser(newUser) });
    return;
  }

  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && method === "PUT") {
    if (!canAccessSettings(user)) {
      sendJson(res, 403, { error: "Acesso reservado ao administrador principal." });
      return;
    }

    const managedUser = appState.users.find((entry) => entry.id === userMatch[1]);
    if (!managedUser) {
      sendJson(res, 404, { error: "Utilizador nao encontrado." });
      return;
    }

    const body = await readJsonBody(req);
    if (managedUser.isSuperAdmin && body.active === false) {
      sendJson(res, 400, { error: "Nao podes desativar o administrador principal." });
      return;
    }

    if (typeof body.displayName === "string" && body.displayName.trim()) {
      managedUser.displayName = body.displayName.trim();
    }
    if (typeof body.active === "boolean") {
      managedUser.active = body.active;
    }
    if (typeof body.password === "string" && body.password.trim()) {
      managedUser.passwordHash = hashPassword(body.password.trim());
    }

    managedUser.updatedAt = new Date().toISOString();
    await persistState();
    sendJson(res, 200, { user: serializeManagedUser(managedUser) });
    return;
  }

  if (userMatch && method === "DELETE") {
    if (!canAccessSettings(user)) {
      sendJson(res, 403, { error: "Acesso reservado ao administrador principal." });
      return;
    }

    const managedUser = appState.users.find((entry) => entry.id === userMatch[1]);
    if (!managedUser) {
      sendJson(res, 404, { error: "Utilizador nao encontrado." });
      return;
    }

    if (managedUser.isSuperAdmin) {
      sendJson(res, 400, { error: "Nao podes remover o administrador principal." });
      return;
    }

    await deleteUser(managedUser.id);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Endpoint nao encontrado." });
}

async function serveStatic(res, pathname) {
  const targetPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(targetPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safePath);

  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = getContentType(ext);
  const file = await fs.readFile(filePath);
  const shouldDisableCache = [".html", ".css", ".js"].includes(ext);

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": shouldDisableCache ? "no-store" : "public, max-age=3600",
  });
  res.end(file);
}

function getContentType(ext) {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("O pedido excede o tamanho maximo permitido.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("JSON invalido.");
    error.statusCode = 400;
    throw error;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }
      accumulator[part.slice(0, separatorIndex)] = decodeURIComponent(
        part.slice(separatorIndex + 1),
      );
      return accumulator;
    }, {});
}

function setSessionCookie(res, sessionToken) {
  const expires = new Date(Date.now() + SESSION_TTL_MS).toUTCString();
  res.setHeader("Set-Cookie", [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; HttpOnly; Path=/; SameSite=Lax; Expires=${expires}`,
  ]);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", [`${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`]);
}

function createSession(userId) {
  const randomToken = crypto.randomBytes(24).toString("base64url");
  const signature = crypto
    .createHmac("sha256", serverSecrets.cookieSecret)
    .update(randomToken)
    .digest("base64url");
  const token = `${randomToken}.${signature}`;
  sessions.set(token, {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    sessions.delete(token);
  }
}

function getCurrentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const session = sessions.get(token);
  if (!session) {
    return null;
  }

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  const [randomToken, signature] = token.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", serverSecrets.cookieSecret)
    .update(randomToken)
    .digest("base64url");

  if (!signature || signature.length !== expectedSignature.length) {
    sessions.delete(token);
    return null;
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    sessions.delete(token);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  const user = appState.users.find((entry) => entry.id === session.userId && entry.active);
  if (!user) {
    sessions.delete(token);
    return null;
  }

  return user;
}

function requireAuth(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Sessao expirada. Inicia sessao novamente." });
    return null;
  }
  return user;
}

function canAccessSettings(user) {
  return Boolean(user?.isSuperAdmin && user.username === ADMIN_USERNAME);
}

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    canAccessSettings: canAccessSettings(user),
  };
}

function serializeManagedUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    isSuperAdmin: user.isSuperAdmin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeSettings() {
  const decryptedKey = appState.settings.openAiApiKeyEncrypted
    ? decryptSecret(appState.settings.openAiApiKeyEncrypted)
    : "";

  return {
    assistantName: appState.settings.assistantName,
    defaultModel: appState.settings.defaultModel,
    codeModel: appState.settings.codeModel,
    imageOutputModel: appState.settings.imageOutputModel,
    systemPrompt: appState.settings.systemPrompt,
    codeSystemPrompt: appState.settings.codeSystemPrompt,
    imageSystemPrompt: appState.settings.imageSystemPrompt,
    reasoningEffort: appState.settings.reasoningEffort,
    maxOutputTokens: appState.settings.maxOutputTokens,
    imageSize: appState.settings.imageSize,
    imageQuality: appState.settings.imageQuality,
    hasApiKey: Boolean(decryptedKey),
    maskedApiKey: maskSecret(decryptedKey),
    updatedAt: appState.settings.updatedAt,
  };
}

function serializePublicAppConfig() {
  return {
    assistantName: appState.settings.assistantName,
    defaultModel: appState.settings.defaultModel,
    codeModel: appState.settings.codeModel,
    imageOutputModel: appState.settings.imageOutputModel,
    imageSize: appState.settings.imageSize,
    imageQuality: appState.settings.imageQuality,
  };
}

function listChatsForUser(userId) {
  return appState.chats
    .filter((chat) => chat.userId === userId)
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
    .map(serializeChat);
}

function serializeChat(chat) {
  const messages = appState.messages.filter((message) => message.chatId === chat.id);
  const lastMessage = messages[messages.length - 1];
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: messages.length,
    preview: lastMessage ? previewFromMessage(lastMessage) : "Sem mensagens ainda.",
  };
}

function listMessagesForChat(chatId) {
  return appState.messages
    .filter((message) => message.chatId === chatId)
    .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
    .map(serializeMessage);
}

function serializeMessage(message) {
  return {
    id: message.id,
    role: message.role,
    mode: normalizeMode(message.mode),
    text: message.text,
    status: message.status,
    createdAt: message.createdAt,
    model: message.model,
    usage: message.usage,
    attachments: (message.attachments || []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      kind: attachment.kind,
      url: `/api/attachments/${attachment.id}`,
    })),
  };
}

function previewFromMessage(message) {
  const label = modeLabel(normalizeMode(message.mode));
  if (message.text) {
    const snippet =
      message.text.length > 68 ? `${message.text.slice(0, 68)}...` : message.text;
    return `[${label}] ${snippet}`;
  }

  if (message.attachments?.length) {
    return `[${label}] ${message.attachments.length} anexo(s)`;
  }

  return `[${label}] Nova mensagem`;
}

function normalizeMode(value) {
  return MODES.includes(value) ? value : "assistant";
}

function normalizeRequestedMode(value) {
  return REQUEST_MODES.includes(value) ? value : "auto";
}

function resolveEffectiveMode(requestedMode, text, attachments) {
  if (requestedMode !== "auto") {
    return normalizeMode(requestedMode);
  }

  const lowered = String(text || "").toLowerCase();
  const hasImageAttachment = attachments.some((attachment) =>
    String(attachment.type || "").toLowerCase().startsWith("image/"),
  );

  const imageIntentPatterns = [
    /gera(?:r)?\s+uma?\s+imagem/,
    /cria(?:r)?\s+uma?\s+imagem/,
    /fotoreal/,
    /realistic/,
    /mockup/,
    /render/,
    /editar?\s+a?\s+imagem/,
    /melhora(?:r)?\s+o\s+realismo/,
  ];

  const codeIntentPatterns = [
    /\bhtml\b/,
    /\bcss\b/,
    /\bjavascript\b/,
    /\btypescript\b/,
    /\bpython\b/,
    /\breact\b/,
    /\bnode\b/,
    /\bapi\b/,
    /\bcodigo\b/,
    /\bsoftware\b/,
    /\bapp\b/,
    /\bbug\b/,
    /\brefactor/,
    /\binterface\b/,
    /\bscreenshot\b/,
    /\bwireframe\b/,
    /\blanding page\b/,
  ];

  if (hasImageAttachment && codeIntentPatterns.some((pattern) => pattern.test(lowered))) {
    return "code";
  }

  if (imageIntentPatterns.some((pattern) => pattern.test(lowered))) {
    return "image";
  }

  if (codeIntentPatterns.some((pattern) => pattern.test(lowered))) {
    return "code";
  }

  return "assistant";
}

function modeLabel(mode) {
  switch (mode) {
    case "code":
      return "Codigo";
    case "image":
      return "Imagem";
    default:
      return "Assistente";
  }
}

function getChatForUser(chatId, userId) {
  return appState.chats.find((chat) => chat.id === chatId && chat.userId === userId) || null;
}

function buildChatTitle(text, mode) {
  const fallbackTitles = {
    assistant: "Conversa assistida",
    code: "Sessao de codigo",
    image: "Projeto visual",
  };
  const compact = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) {
    return fallbackTitles[mode] || fallbackTitles.assistant;
  }
  return compact.length <= 42 ? compact : `${compact.slice(0, 42)}...`;
}

async function saveIncomingAttachments(chatId, attachments) {
  const saved = [];

  for (const rawAttachment of attachments) {
    const name = sanitizeFilename(String(rawAttachment.name || "anexo"));
    const mimeType = String(rawAttachment.type || "application/octet-stream");
    const dataUrl = String(rawAttachment.dataUrl || "");
    if (!dataUrl.startsWith("data:")) {
      throw new Error("Anexo invalido.");
    }

    const { buffer } = decodeDataUrl(dataUrl);
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`O ficheiro ${name} excede o limite de 8 MB.`);
    }

    saved.push(
      await writeAttachmentFile(chatId, {
        buffer,
        filename: name,
        mimeType,
        kind: mimeType.startsWith("image/") ? "image" : "file",
      }),
    );
  }

  return saved;
}

async function saveGeneratedImageAttachment(chatId, { imageBase64, format = "png" }) {
  const buffer = Buffer.from(imageBase64, "base64");
  if (!buffer.length) {
    throw new Error("A OpenAI nao devolveu imagem gerada.");
  }

  const extension = normalizeImageExtension(format);
  return writeAttachmentFile(chatId, {
    buffer,
    filename: `generated-${crypto.randomUUID()}.${extension}`,
    mimeType: `image/${extension === "jpg" ? "jpeg" : extension}`,
    kind: "generated-image",
  });
}

async function writeAttachmentFile(chatId, { buffer, filename, mimeType, kind }) {
  const attachmentId = crypto.randomUUID();
  const relativePath = path.join("uploads", chatId, `${attachmentId}-${filename}`);
  const absolutePath = path.join(DATA_DIR, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  return {
    id: attachmentId,
    name: filename,
    mimeType,
    size: buffer.length,
    kind,
    relativePath,
  };
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9._-]/gi, "_").slice(0, 80) || "anexo";
}

function decodeDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Formato de anexo nao suportado.");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function requestTextResponse({ user, chat, text, attachments, mode }) {
  const apiKey = getOpenAiApiKey();
  const inputContent = buildTextInputContent(text, attachments, mode);
  const model = selectModelForMode(mode);
  const payload = {
    model,
    instructions: buildInstructionsForMode(mode),
    input: [
      {
        role: "user",
        content: inputContent,
      },
    ],
    previous_response_id: chat.responseMemory?.[mode] || undefined,
    max_output_tokens: Number(appState.settings.maxOutputTokens || DEFAULT_SETTINGS.maxOutputTokens),
    store: true,
    metadata: {
      local_user: user.username,
      local_chat: chat.id,
      local_mode: mode,
    },
  };

  if (supportsReasoning(model)) {
    payload.reasoning = {
      effort: appState.settings.reasoningEffort || DEFAULT_SETTINGS.reasoningEffort,
    };
  }

  const response = await callOpenAiJson({
    apiKey,
    endpoint: "https://api.openai.com/v1/responses",
    payload,
  });

  const textOutput = extractAssistantText(response);
  return {
    text: textOutput || "Sem texto de resposta produzido pelo modelo.",
    responseId: response.id || null,
    model: response.model || model,
    usage: response.usage || null,
  };
}

function buildTextInputContent(text, attachments, mode) {
  const inputContent = [];
  const effectiveText = text || buildFallbackPrompt(mode, attachments);

  if (effectiveText) {
    inputContent.push({
      type: "input_text",
      text: effectiveText,
    });
  }

  for (const attachment of attachments) {
    const mimeType = String(attachment.type || "");
    const dataUrl = String(attachment.dataUrl || "");
    const filename = sanitizeFilename(String(attachment.name || "anexo"));

    if (!dataUrl) {
      continue;
    }

    if (mimeType.startsWith("image/")) {
      inputContent.push({
        type: "input_image",
        image_url: dataUrl,
        detail: "high",
      });
      continue;
    }

    inputContent.push({
      type: "input_file",
      filename,
      file_data: dataUrl,
    });
  }

  return inputContent;
}

function buildFallbackPrompt(mode, attachments) {
  if (mode === "code") {
    return attachments.some((attachment) => String(attachment.type || "").startsWith("image/"))
      ? "Recria a interface mostrada na imagem em HTML e CSS puros, responsivos, semanticamente corretos e prontos a abrir no browser. Entrega o codigo final completo."
      : "Produz a melhor resposta de engenharia de software para este pedido, com codigo final e observacoes curtas quando for util.";
  }

  if (mode === "image") {
    return attachments.some((attachment) => String(attachment.type || "").startsWith("image/"))
      ? "Edita a imagem de referencia para a tornar mais realista, polida e visualmente premium."
      : "Cria uma imagem ultra-realista, detalhada e visualmente forte a partir deste pedido.";
  }

  return "Analisa os anexos enviados e ajuda o utilizador da forma mais pratica possivel.";
}

function buildInstructionsForMode(mode) {
  const basePrompt =
    appState.settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt;
  const assistantName =
    appState.settings.assistantName || DEFAULT_SETTINGS.assistantName;

  if (mode === "code") {
    const codePrompt =
      appState.settings.codeSystemPrompt || DEFAULT_SETTINGS.codeSystemPrompt;
    return `${basePrompt}\n\n${codePrompt}\n\nAssistant name: ${assistantName}.\nDefault language for responses: European Portuguese unless the user requests another language.`;
  }

  return `${basePrompt}\n\nAssistant name: ${assistantName}.\nDefault language for responses: European Portuguese unless the user requests another language.`;
}

async function requestImageResponse({ chat, text, attachments }) {
  const apiKey = getOpenAiApiKey();
  const prompt = buildImagePrompt(text, attachments);
  const imageModel = normalizeImageModelIdentifier(
    appState.settings.imageOutputModel || DEFAULT_SETTINGS.imageOutputModel,
  );
  const imageModelConfig = getImageModelConfig(imageModel);
  const liveReferences = collectEditableImageReferences(attachments);
  const wantsEdit = shouldEditImageRequest(text, attachments);

  let action = "generate";
  let references = [];

  if (liveReferences.length || wantsEdit) {
    if (!imageModelConfig.supportsEdits) {
      throw new Error(
        `O modelo de imagem atual (${imageModel}) gera imagens novas mas nao suporta edicao direta. Para editar imagens, muda para dall-e-2 ou verifica a organizacao e usa um modelo GPT Image.`,
      );
    }

    const historyReferences = liveReferences.length
      ? []
      : await getRecentImageReferences(chat.id, MAX_HISTORY_IMAGE_REFERENCES);
    references = [...liveReferences, ...historyReferences].slice(0, MAX_HISTORY_IMAGE_REFERENCES);

    if (!references.length) {
      throw new Error(
        "Nao encontrei uma imagem anterior ou anexo de imagem para editar nesta conversa.",
      );
    }

    action = "edit";
  }

  const imageResult =
    action === "edit"
      ? await requestImageEdit({
          apiKey,
          prompt,
          references,
          model: imageModel,
        })
      : await requestImageGeneration({
          apiKey,
          prompt,
          model: imageModel,
        });

  const savedAttachment = await saveGeneratedImageAttachment(chat.id, {
    imageBase64: imageResult.imageBase64,
    format: imageResult.format,
  });

  const textSummary = buildImageResultSummary({
    prompt,
    action,
    revisedPrompt: imageResult.revisedPrompt,
  });

  return {
    text: textSummary,
    attachments: [savedAttachment],
    responseId: null,
    model: imageModel,
    usage: imageResult.usage || null,
  };
}

function buildImagePrompt(text, attachments) {
  const userText = text || buildFallbackPrompt("image", attachments);
  const imagePrompt =
    appState.settings.imageSystemPrompt || DEFAULT_SETTINGS.imageSystemPrompt;

  return `${imagePrompt}\n\nUser request:\n${userText}\n\nIf the user did not ask for illustration or stylization, prefer a realistic photographic result with strong materials, lighting, texture fidelity, clean composition, and believable depth.`;
}

function collectEditableImageReferences(attachments) {
  const references = [];
  for (const attachment of attachments) {
    const mimeType = String(attachment.type || "").toLowerCase();
    if (!isEditableImageMimeType(mimeType)) {
      continue;
    }

    const dataUrl = String(attachment.dataUrl || "");
    if (!dataUrl) {
      continue;
    }

    const { buffer } = decodeDataUrl(dataUrl);
    references.push({
      name: sanitizeFilename(String(attachment.name || "reference.png")),
      mimeType,
      buffer,
    });
  }
  return references;
}

async function getRecentImageReferences(chatId, limit) {
  const references = [];
  const messages = appState.messages
    .filter((message) => message.chatId === chatId)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

  for (const message of messages) {
    for (const attachment of message.attachments || []) {
      if (!String(attachment.mimeType || "").startsWith("image/")) {
        continue;
      }

      const absolutePath = path.join(DATA_DIR, attachment.relativePath);
      try {
        const buffer = await fs.readFile(absolutePath);
        references.push({
          name: sanitizeFilename(attachment.name),
          mimeType: attachment.mimeType,
          buffer,
        });
      } catch {
        // Ignore missing files and continue.
      }

      if (references.length >= limit) {
        return references;
      }
    }
  }

  return references;
}

function isEditableImageMimeType(mimeType) {
  return ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType);
}

function shouldEditImageRequest(text, attachments) {
  const hasImageAttachment = attachments.some((attachment) =>
    isEditableImageMimeType(String(attachment.type || attachment.mimeType || "").toLowerCase()),
  );

  if (hasImageAttachment) {
    return true;
  }

  const lowered = String(text || "").toLowerCase();
  return IMAGE_EDIT_INTENT_PATTERNS.some((pattern) => pattern.test(lowered));
}

async function requestImageGeneration({ apiKey, prompt, model }) {
  const imageModel = normalizeImageModelIdentifier(model);
  const imageConfig = getImageModelConfig(imageModel);
  const payload = {
    model: imageModel,
    prompt,
    size: normalizeImageSizeForModel(appState.settings.imageSize, imageModel),
  };

  const normalizedQuality = normalizeImageQualityForModel(appState.settings.imageQuality, imageModel);
  if (shouldSendImageQuality(imageModel, normalizedQuality)) {
    payload.quality = normalizedQuality;
  }

  if (imageConfig.family === "gpt-image") {
    payload.output_format = "png";
  } else {
    payload.response_format = "b64_json";
    payload.n = 1;
  }

  const response = await callOpenAiImageJsonWithFallback({
    apiKey,
    endpoint: "https://api.openai.com/v1/images/generations",
    payload,
  });

  const firstImage = response.data?.[0];
  if (!firstImage?.b64_json) {
    throw new Error("A API de imagem nao devolveu dados para a geracao.");
  }

  return {
    imageBase64: firstImage.b64_json,
    revisedPrompt: firstImage.revised_prompt || response.revised_prompt || "",
    format: "png",
    usage: response.usage || null,
  };
}

async function requestImageEdit({ apiKey, prompt, references, model }) {
  const imageModel = normalizeImageModelIdentifier(model);
  const imageConfig = getImageModelConfig(imageModel);
  if (!imageConfig.supportsEdits) {
    throw new Error(`O modelo ${imageModel} nao suporta edicao direta de imagens nesta app.`);
  }

  const form = new FormData();
  form.append("model", imageModel);
  form.append("prompt", prompt);
  form.append("size", normalizeImageSizeForModel(appState.settings.imageSize, imageModel));

  const normalizedQuality = normalizeImageQualityForModel(appState.settings.imageQuality, imageModel);
  if (shouldSendImageQuality(imageModel, normalizedQuality)) {
    form.append("quality", normalizedQuality);
  }

  if (imageConfig.family === "gpt-image") {
    form.append("output_format", "png");
  } else {
    form.append("response_format", "b64_json");
  }

  for (const reference of references) {
    const blob = new Blob([reference.buffer], { type: reference.mimeType });
    form.append("image", blob, reference.name);
  }

  const response = await callOpenAiImageMultipartWithFallback({
    apiKey,
    endpoint: "https://api.openai.com/v1/images/edits",
    body: form,
  });

  const firstImage = response.data?.[0];
  if (!firstImage?.b64_json) {
    throw new Error("A API de imagem nao devolveu dados para a edicao.");
  }

  return {
    imageBase64: firstImage.b64_json,
    revisedPrompt: firstImage.revised_prompt || response.revised_prompt || "",
    format: "png",
    usage: response.usage || null,
  };
}

function buildImageResultSummary({ action, revisedPrompt }) {
  const intro =
    action === "edit"
      ? "Imagem editada e regenerada com foco em realismo e acabamento."
      : "Imagem gerada com foco em realismo e detalhe.";

  if (!revisedPrompt) {
    return intro;
  }

  return `${intro}\n\nPrompt optimizado:\n${revisedPrompt}`;
}

function selectModelForMode(mode) {
  if (mode === "code") {
    return appState.settings.codeModel || DEFAULT_SETTINGS.codeModel;
  }
  if (mode === "image") {
    return appState.settings.imageOutputModel || DEFAULT_SETTINGS.imageOutputModel;
  }
  return appState.settings.defaultModel || DEFAULT_SETTINGS.defaultModel;
}

function supportsReasoning(model) {
  return (
    typeof model === "string" &&
    !model.includes("chat-latest") &&
    (model.startsWith("gpt-5") || model.startsWith("o"))
  );
}

async function callOpenAiJson({ apiKey, endpoint, payload }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    throw normalizeOpenAiTransportError(error);
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(extractOpenAiError(data, "A API da OpenAI devolveu um erro."));
  }

  return data;
}

async function callOpenAiMultipart({ apiKey, endpoint, body }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    throw normalizeOpenAiTransportError(error);
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(extractOpenAiError(data, "A API de imagem da OpenAI devolveu um erro."));
  }

  return data;
}

async function callOpenAiImageJsonWithFallback({ apiKey, endpoint, payload }) {
  const nextPayload = { ...payload };

  while (true) {
    try {
      return await callOpenAiJson({
        apiKey,
        endpoint,
        payload: nextPayload,
      });
    } catch (error) {
      const unsupportedParameter = extractUnknownParameterName(error);
      if (!unsupportedParameter || !(unsupportedParameter in nextPayload)) {
        throw error;
      }

      delete nextPayload[unsupportedParameter];
    }
  }
}

async function callOpenAiImageMultipartWithFallback({ apiKey, endpoint, body }) {
  let currentBody = body;

  while (true) {
    try {
      return await callOpenAiMultipart({
        apiKey,
        endpoint,
        body: currentBody,
      });
    } catch (error) {
      const unsupportedParameter = extractUnknownParameterName(error);
      if (!unsupportedParameter || !hasFormDataField(currentBody, unsupportedParameter)) {
        throw error;
      }

      currentBody = cloneFormDataWithoutField(currentBody, unsupportedParameter);
    }
  }
}

function normalizeOpenAiTransportError(error) {
  if (error?.cause?.code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") {
    return new Error(
      "Falha TLS ao contactar a OpenAI. Inicia a aplicacao pelos scripts start.ps1 ou start.cmd para usar os certificados do sistema.",
    );
  }

  if (error?.name === "AbortError") {
    return new Error("A OpenAI demorou demasiado tempo a responder.");
  }

  return error;
}

function extractOpenAiError(payload, fallback) {
  return (
    payload?.error?.message ||
    payload?.message ||
    fallback
  );
}

function extractUnknownParameterName(error) {
  const message = String(error?.message || "");
  const match = message.match(/Unknown parameter:\s*'([^']+)'/i);
  return match?.[1] || null;
}

function hasFormDataField(form, fieldName) {
  for (const [key] of form.entries()) {
    if (key === fieldName) {
      return true;
    }
  }
  return false;
}

function cloneFormDataWithoutField(form, fieldName) {
  const nextForm = new FormData();
  for (const [key, value] of form.entries()) {
    if (key === fieldName) {
      continue;
    }

    if (typeof value === "string") {
      nextForm.append(key, value);
      continue;
    }

    const filename = typeof value?.name === "string" ? value.name : undefined;
    if (filename) {
      nextForm.append(key, value, filename);
    } else {
      nextForm.append(key, value);
    }
  }
  return nextForm;
}

function extractAssistantText(responsePayload) {
  if (typeof responsePayload.output_text === "string" && responsePayload.output_text.trim()) {
    return responsePayload.output_text.trim();
  }

  const parts = [];
  for (const item of responsePayload.output || []) {
    if (item.type !== "message" || item.role !== "assistant") {
      continue;
    }
    for (const contentItem of item.content || []) {
      if (contentItem.type === "output_text" && contentItem.text) {
        parts.push(contentItem.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function validateReasoningEffort(value) {
  return ["minimal", "low", "medium", "high", "xhigh"].includes(value)
    ? value
    : DEFAULT_SETTINGS.reasoningEffort;
}

function validateMaxOutputTokens(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.maxOutputTokens;
  }
  return Math.max(256, Math.min(12000, Math.round(parsed)));
}

function validateImageSize(value) {
  return normalizeImageSizeForModel(
    value,
    appState?.settings?.imageOutputModel || DEFAULT_SETTINGS.imageOutputModel,
  );
}

function validateImageQuality(value) {
  return normalizeImageQualityForModel(
    value,
    appState?.settings?.imageOutputModel || DEFAULT_SETTINGS.imageOutputModel,
  );
}

function normalizeImageModelIdentifier(value) {
  return String(value || "").trim().toLowerCase() || DEFAULT_SETTINGS.imageOutputModel;
}

function getImageModelConfig(model) {
  const family = getImageModelFamily(model);

  if (family === "dall-e-3") {
    return {
      family,
      supportsEdits: false,
      supportedSizes: ["1024x1024", "1024x1536", "1536x1024"],
      supportedQualities: ["standard", "hd"],
      defaultSize: "1024x1024",
      defaultQuality: "hd",
    };
  }

  if (family === "dall-e-2") {
    return {
      family,
      supportsEdits: true,
      supportedSizes: ["1024x1024", "1024x1536", "1536x1024"],
      supportedQualities: ["standard"],
      defaultSize: "1024x1024",
      defaultQuality: "standard",
    };
  }

  return {
    family: "gpt-image",
    supportsEdits: true,
    supportedSizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
    supportedQualities: ["low", "medium", "high", "auto"],
    defaultSize: "1536x1024",
    defaultQuality: "high",
  };
}

function getImageModelFamily(model) {
  const normalized = normalizeImageModelIdentifier(model);
  if (normalized.startsWith("dall-e-3")) {
    return "dall-e-3";
  }
  if (normalized.startsWith("dall-e-2")) {
    return "dall-e-2";
  }
  if (normalized === "chatgpt-image-latest" || normalized.startsWith("gpt-image")) {
    return "gpt-image";
  }
  return "gpt-image";
}

function normalizeImageSizeForModel(value, model) {
  const config = getImageModelConfig(model);
  const normalized = String(value || "").trim().toLowerCase();
  return config.supportedSizes.includes(normalized) ? normalized : config.defaultSize;
}

function normalizeImageQualityForModel(value, model) {
  const config = getImageModelConfig(model);
  const normalized = String(value || "").trim().toLowerCase();
  return config.supportedQualities.includes(normalized)
    ? normalized
    : config.defaultQuality;
}

function shouldSendImageQuality(model, quality) {
  const family = getImageModelFamily(model);
  if (!quality) {
    return false;
  }

  if (family === "dall-e-3") {
    return false;
  }

  return true;
}

function normalizeImageExtension(format) {
  const lower = String(format || "png").toLowerCase();
  if (["png", "jpg", "jpeg", "webp"].includes(lower)) {
    return lower === "jpeg" ? "jpg" : lower;
  }
  return "png";
}

function getOpenAiApiKey() {
  const apiKey = appState.settings.openAiApiKeyEncrypted
    ? decryptSecret(appState.settings.openAiApiKeyEncrypted)
    : "";

  if (!apiKey) {
    throw new Error("A chave da OpenAI ainda nao foi configurada.");
  }

  return apiKey;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("base64url");
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(":");
  if (!salt || !expected) {
    return false;
  }

  const derived = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("base64url");
  return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(expected));
}

function encryptSecret(secretValue) {
  const key = Buffer.from(serverSecrets.encryptionKey, "base64");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secretValue, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(payload) {
  const [ivBase64, tagBase64, contentBase64] = String(payload).split(".");
  if (!ivBase64 || !tagBase64 || !contentBase64) {
    return "";
  }

  const key = Buffer.from(serverSecrets.encryptionKey, "base64");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivBase64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(contentBase64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function maskSecret(secretValue) {
  if (!secretValue) {
    return "Nao definida";
  }
  if (secretValue.length < 12) {
    return "••••••••";
  }
  return `${secretValue.slice(0, 7)}••••••${secretValue.slice(-4)}`;
}

async function persistState() {
  saveQueue = saveQueue.then(async () => {
    const tempFile = `${STATE_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(appState, null, 2), "utf8");
    await fs.rename(tempFile, STATE_FILE);
  });
  return saveQueue;
}

async function findAttachmentForUser(attachmentId, userId) {
  for (const message of appState.messages) {
    const chat = appState.chats.find((entry) => entry.id === message.chatId);
    if (!chat || chat.userId !== userId) {
      continue;
    }

    const match = (message.attachments || []).find((attachment) => attachment.id === attachmentId);
    if (match) {
      return match;
    }
  }

  return null;
}

async function deleteChat(chatId) {
  const messagesToDelete = appState.messages.filter((message) => message.chatId === chatId);
  for (const message of messagesToDelete) {
    for (const attachment of message.attachments || []) {
      const attachmentPath = path.join(DATA_DIR, attachment.relativePath);
      await fs.rm(attachmentPath, { force: true }).catch(() => {});
    }
  }

  const chatFolder = path.join(UPLOADS_DIR, chatId);
  await fs.rm(chatFolder, { recursive: true, force: true }).catch(() => {});

  appState.messages = appState.messages.filter((message) => message.chatId !== chatId);
  appState.chats = appState.chats.filter((chat) => chat.id !== chatId);
  await persistState();
}

async function deleteUser(userId) {
  const userChats = appState.chats.filter((chat) => chat.userId === userId);
  for (const chat of userChats) {
    await deleteChat(chat.id);
  }

  appState.users = appState.users.filter((user) => user.id !== userId);
  await persistState();
}
