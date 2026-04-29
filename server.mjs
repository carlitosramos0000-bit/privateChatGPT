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
const BOOTSTRAP_OPENAI_KEY = process.env.BOOTSTRAP_OPENAI_KEY?.trim() || "";
const ADMIN_USERNAME = "ramoscv";
const ADMIN_PASSWORD = "Logica!1";

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

    await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error("Unexpected server error", error);
    sendJson(res, error?.statusCode || 500, {
      error: error?.message || "Erro interno do servidor.",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Logic Chat a correr em http://localhost:${PORT}`);
});

async function bootstrap() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  serverSecrets = await loadOrCreateSecrets();
  appState = await loadOrCreateState();
  await ensureDefaultAdmin();
}

async function loadOrCreateSecrets() {
  try {
    const raw = await fs.readFile(SECRET_FILE, "utf8");
    return JSON.parse(raw);
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
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    const seededSettings = {
      assistantName: "Logic Chat",
      defaultModel: "gpt-5.3-chat-latest",
      systemPrompt:
        "És um assistente útil, rigoroso e profissional. Responde de forma clara, organizada e com foco em ajudar o utilizador.",
      reasoningEffort: "medium",
      maxOutputTokens: 2200,
      openAiApiKeyEncrypted: BOOTSTRAP_OPENAI_KEY ? encryptSecret(BOOTSTRAP_OPENAI_KEY) : null,
      updatedAt: new Date().toISOString(),
    };

    const initialState = {
      version: 1,
      settings: seededSettings,
      users: [
        {
          id: crypto.randomUUID(),
          username: ADMIN_USERNAME,
          displayName: "Ramos CV",
          passwordHash: hashPassword(ADMIN_PASSWORD),
          role: "admin",
          isSuperAdmin: true,
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      chats: [],
      messages: [],
    };

    await fs.writeFile(STATE_FILE, JSON.stringify(initialState, null, 2), "utf8");
    return initialState;
  }
}

async function ensureDefaultAdmin() {
  let admin = appState.users.find((user) => user.username === ADMIN_USERNAME);

  if (!admin) {
    admin = {
      id: crypto.randomUUID(),
      username: ADMIN_USERNAME,
      displayName: "Ramos CV",
      passwordHash: hashPassword(ADMIN_PASSWORD),
      role: "admin",
      isSuperAdmin: true,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    appState.users.push(admin);
    await persistState();
    return;
  }

  if (!admin.isSuperAdmin) {
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
      sendJson(res, 401, {
        error: "Utilizador ou palavra-passe inválidos.",
      });
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
    const text = String(body.title || "").trim();
    const now = new Date().toISOString();
    const chat = {
      id: crypto.randomUUID(),
      userId: user.id,
      title: text || "Nova conversa",
      previousResponseId: null,
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
      sendJson(res, 404, { error: "Conversa não encontrada." });
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
      sendJson(res, 404, { error: "Conversa não encontrada." });
      return;
    }

    const body = await readJsonBody(req);
    const text = String(body.text || "").trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];

    if (!text && attachments.length === 0) {
      sendJson(res, 400, { error: "Escreve uma mensagem ou adiciona um anexo." });
      return;
    }

    if (attachments.length > MAX_ATTACHMENTS) {
      sendJson(res, 400, { error: `Podes enviar até ${MAX_ATTACHMENTS} anexos por mensagem.` });
      return;
    }

    const storedAttachments = await saveAttachments(chat.id, attachments);
    const now = new Date().toISOString();
    const userMessage = {
      id: crypto.randomUUID(),
      chatId: chat.id,
      role: "user",
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
    if (chat.title === "Nova conversa" && text) {
      chat.title = buildChatTitle(text);
    }

    let assistantMessage = null;
    let warning = null;

    try {
      const completion = await requestOpenAiResponse({
        user,
        chat,
        text,
        attachments,
      });

      assistantMessage = {
        id: crypto.randomUUID(),
        chatId: chat.id,
        role: "assistant",
        text: completion.text,
        attachments: [],
        status: "sent",
        createdAt: new Date().toISOString(),
        model: completion.model,
        responseId: completion.responseId,
        usage: completion.usage,
      };

      chat.previousResponseId = completion.responseId;
      chat.updatedAt = assistantMessage.createdAt;
      appState.messages.push(assistantMessage);
    } catch (error) {
      warning = error.message || "Falha ao contactar a OpenAI.";
      assistantMessage = {
        id: crypto.randomUUID(),
        chatId: chat.id,
        role: "assistant",
        text:
          "Nao foi possivel concluir este pedido agora. Verifica a configuracao da chave, o modelo selecionado ou os limites da conta OpenAI.",
        attachments: [],
        status: "failed",
        createdAt: new Date().toISOString(),
        model: appState.settings.defaultModel,
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
      sendJson(res, 404, { error: "Conversa não encontrada." });
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
      sendJson(res, 404, { error: "Anexo não encontrado." });
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
    const incomingModel = String(body.defaultModel || "").trim();
    const incomingPrompt = String(body.systemPrompt || "").trim();
    const incomingAssistantName = String(body.assistantName || "").trim();
    const incomingApiKey = String(body.openAiApiKey || "").trim();
    const incomingReasoningEffort = String(body.reasoningEffort || "medium").trim();
    const incomingMaxOutputTokens = Number(body.maxOutputTokens || 2200);

    appState.settings.defaultModel = incomingModel || appState.settings.defaultModel || "gpt-5.3-chat-latest";
    appState.settings.systemPrompt = incomingPrompt || appState.settings.systemPrompt;
    appState.settings.assistantName = incomingAssistantName || appState.settings.assistantName || "Logic Chat";
    appState.settings.reasoningEffort = incomingReasoningEffort || "medium";
    appState.settings.maxOutputTokens = Number.isFinite(incomingMaxOutputTokens)
      ? Math.max(256, Math.min(12000, Math.round(incomingMaxOutputTokens)))
      : 2200;
    appState.settings.updatedAt = new Date().toISOString();

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
        error: "O utilizador deve ter entre 3 e 30 caracteres e usar apenas letras, numeros, ponto, underscore ou hifen.",
      });
      return;
    }

    if (appState.users.some((entry) => entry.username.toLowerCase() === username.toLowerCase())) {
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

async function serveStatic(req, res, pathname) {
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

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
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
    const raw = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(raw);
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
      const key = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      accumulator[key] = decodeURIComponent(value);
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
    systemPrompt: appState.settings.systemPrompt,
    reasoningEffort: appState.settings.reasoningEffort,
    maxOutputTokens: appState.settings.maxOutputTokens,
    hasApiKey: Boolean(decryptedKey),
    maskedApiKey: maskSecret(decryptedKey),
    updatedAt: appState.settings.updatedAt,
  };
}

function serializePublicAppConfig() {
  return {
    assistantName: appState.settings.assistantName,
    defaultModel: appState.settings.defaultModel,
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
  if (message.text) {
    return message.text.length > 72 ? `${message.text.slice(0, 72)}...` : message.text;
  }
  if (message.attachments?.length) {
    return `${message.attachments.length} anexo(s)`;
  }
  return "Nova mensagem";
}

function getChatForUser(chatId, userId) {
  return appState.chats.find((chat) => chat.id === chatId && chat.userId === userId) || null;
}

function buildChatTitle(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 42 ? compact : `${compact.slice(0, 42)}...`;
}

async function saveAttachments(chatId, attachments) {
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

    const attachmentId = crypto.randomUUID();
    const relativePath = path.join("uploads", chatId, `${attachmentId}-${name}`);
    const absolutePath = path.join(DATA_DIR, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);

    saved.push({
      id: attachmentId,
      name,
      mimeType,
      size: buffer.length,
      kind: mimeType.startsWith("image/") ? "image" : "file",
      relativePath,
    });
  }

  return saved;
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

async function requestOpenAiResponse({ user, chat, text, attachments }) {
  const apiKey = appState.settings.openAiApiKeyEncrypted
    ? decryptSecret(appState.settings.openAiApiKeyEncrypted)
    : "";

  if (!apiKey) {
    throw new Error("A chave da OpenAI ainda nao foi configurada.");
  }

  const inputContent = [];
  if (text) {
    inputContent.push({
      type: "input_text",
      text,
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
        detail: "auto",
      });
      continue;
    }

    inputContent.push({
      type: "input_file",
      filename,
      file_data: dataUrl,
    });
  }

  if (inputContent.length === 0) {
    inputContent.push({
      type: "input_text",
      text: "Analisa os anexos enviados e ajuda o utilizador.",
    });
  }

  const payload = {
    model: appState.settings.defaultModel || "gpt-5.3-chat-latest",
    instructions: buildInstructions(),
    input: [
      {
        role: "user",
        content: inputContent,
      },
    ],
    previous_response_id: chat.previousResponseId || undefined,
    max_output_tokens: Number(appState.settings.maxOutputTokens || 2200),
    store: true,
    metadata: {
      local_user: user.username,
      local_chat: chat.id,
    },
  };

  if (supportsReasoning(payload.model)) {
    payload.reasoning = {
      effort: appState.settings.reasoningEffort || "medium",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.cause?.code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") {
      throw new Error(
        "Falha TLS ao contactar a OpenAI. Inicia a aplicacao pelos scripts start.ps1 ou start.cmd para usar os certificados do sistema.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || "A API da OpenAI devolveu um erro.");
  }

  const textOutput = extractAssistantText(data);
  return {
    text: textOutput || "Sem texto de resposta produzido pelo modelo.",
    responseId: data.id || null,
    model: data.model || payload.model,
    usage: data.usage || null,
  };
}

function buildInstructions() {
  const assistantName = appState.settings.assistantName || "Logic Chat";
  const systemPrompt =
    appState.settings.systemPrompt ||
    "És um assistente útil, rigoroso e profissional. Responde de forma clara, organizada e com foco em ajudar o utilizador.";

  return `${systemPrompt}\n\nNome do assistente: ${assistantName}.\nIdioma por omissao: portugues europeu, exceto se o utilizador pedir outro idioma.`;
}

function supportsReasoning(model) {
  return !String(model).includes("chat-latest") && (String(model).startsWith("gpt-5") || String(model).startsWith("o"));
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
