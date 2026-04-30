const APP_NAME = "Private ChatGPT Pro";
const APP_SIGNATURE = "by Carlos Ramos";
const MOBILE_SIDEBAR_BREAKPOINT = 1040;
let globalEventsBound = false;

const MODE_META = {
  auto: {
    label: "Auto",
    hint: "Escolhe automaticamente entre assistente, codigo e imagem.",
  },
  assistant: {
    label: "Assistente",
    hint: "Conversas, analise de documentos e ajuda geral.",
  },
  code: {
    label: "Codigo",
    hint: "Software, debugging, geracao de codigo e HTML/CSS a partir de imagens.",
  },
  image: {
    label: "Imagem",
    hint: "Geracao e edicao de imagens com foco em realismo.",
  },
};

const PRESETS = {
  auto: [
    {
      id: "auto-image",
      mode: "image",
      label: "Imagem realista",
      prompt:
        "Gera uma imagem ultra-realista, muito detalhada, com iluminacao natural, materiais crediveis e acabamento premium.",
    },
    {
      id: "auto-code",
      mode: "code",
      label: "Gerar software",
      prompt:
        "Desenha a melhor solucao de software para este pedido e entrega o codigo final pronto a usar.",
    },
    {
      id: "auto-html",
      mode: "code",
      label: "HTML/CSS da imagem",
      prompt:
        "Recria a interface mostrada na imagem em HTML e CSS puros, responsivos, semanticamente corretos e prontos a abrir no browser. Entrega o codigo completo.",
    },
  ],
  assistant: [
    {
      id: "assistant-summary",
      mode: "assistant",
      label: "Resumo estruturado",
      prompt:
        "Resume este conteudo com clareza e organiza a resposta em pontos de decisao, riscos e proximos passos.",
    },
    {
      id: "assistant-plan",
      mode: "assistant",
      label: "Plano detalhado",
      prompt:
        "Cria um plano detalhado, com prioridades, dependencias e entregaveis objetivos.",
    },
  ],
  code: [
    {
      id: "code-build",
      mode: "code",
      label: "Gerar codigo",
      prompt:
        "Produz uma implementacao de software pronta a usar, com estrutura clara, ficheiros necessarios e codigo final completo.",
    },
    {
      id: "code-image-html",
      mode: "code",
      label: "HTML/CSS da imagem",
      prompt:
        "Recria a interface mostrada na imagem em HTML e CSS puros, responsivos, semanticamente corretos e prontos a abrir no browser. Entrega o codigo completo.",
    },
    {
      id: "code-review",
      mode: "code",
      label: "Corrigir bug",
      prompt:
        "Analisa o problema, encontra a causa, propoe a correcao e entrega o codigo final com explicacao curta.",
    },
  ],
  image: [
    {
      id: "image-real",
      mode: "image",
      label: "Ultra-realista",
      prompt:
        "Gera uma imagem ultra-realista, com textura fina, materiais crediveis, profundidade natural e iluminacao premium.",
    },
    {
      id: "image-edit",
      mode: "image",
      label: "Editar ultima imagem",
      prompt:
        "Edita a ultima imagem mantendo a identidade principal, mas melhora o realismo, a luz, a nitidez e os detalhes.",
    },
    {
      id: "image-product",
      mode: "image",
      label: "Mockup premium",
      prompt:
        "Cria um mockup fotorealista e elegante deste conceito/produto com enquadramento profissional.",
    },
  ],
};

const state = {
  booting: true,
  authenticating: false,
  user: null,
  chats: [],
  activeChatId: null,
  messages: [],
  view: "chat",
  loadingChats: false,
  loadingMessages: false,
  pendingMessage: false,
  composerText: "",
  composerAttachments: [],
  composerMode: "auto",
  mobileSidebarOpen: false,
  settings: null,
  users: [],
  loadingAdmin: false,
  savingSettings: false,
  creatingUser: false,
  loginError: "",
  toasts: [],
};

const app = document.querySelector("#app");

boot();

async function boot() {
  if (!globalEventsBound) {
    bindGlobalEvents();
    globalEventsBound = true;
  }

  render();
  try {
    const response = await api("/api/me");
    if (response.user) {
      state.user = response.user;
      state.settings = { ...(state.settings || {}), ...(response.appConfig || {}) };
      await loadChats();
    }
  } catch (error) {
    pushToast("Falha ao iniciar a aplicacao.", error.message, "error");
  } finally {
    state.booting = false;
    render();
  }
}

async function api(url, options = {}) {
  const request = {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "same-origin",
    ...options,
  };

  if (request.body && typeof request.body !== "string") {
    request.body = JSON.stringify(request.body);
  }

  if (!request.body) {
    delete request.headers["Content-Type"];
  }

  const response = await fetch(url, request);
  const data = await response
    .json()
    .catch(() => ({ error: "Resposta inesperada do servidor." }));

  if (!response.ok) {
    const error = new Error(data.error || "Erro ao comunicar com o servidor.");
    error.payload = data;
    throw error;
  }

  return data;
}

async function loadChats() {
  state.loadingChats = true;
  render();

  try {
    const response = await api("/api/chats");
    state.chats = response.chats || [];

    if (!state.activeChatId && state.chats.length > 0) {
      state.activeChatId = state.chats[0].id;
      await loadMessages(state.activeChatId);
    } else if (state.activeChatId) {
      const activeExists = state.chats.some((chat) => chat.id === state.activeChatId);
      if (!activeExists) {
        state.activeChatId = state.chats[0]?.id || null;
        if (state.activeChatId) {
          await loadMessages(state.activeChatId);
        } else {
          state.messages = [];
        }
      }
    }
  } catch (error) {
    pushToast("Nao foi possivel carregar as conversas.", error.message, "error");
  } finally {
    state.loadingChats = false;
    render();
  }
}

async function loadMessages(chatId) {
  if (!chatId) {
    state.messages = [];
    state.activeChatId = null;
    render();
    return;
  }

  state.loadingMessages = true;
  state.activeChatId = chatId;
  render();

  try {
    const response = await api(`/api/chats/${chatId}/messages`);
    state.messages = response.messages || [];
  } catch (error) {
    pushToast("Nao foi possivel abrir a conversa.", error.message, "error");
    state.messages = [];
  } finally {
    state.loadingMessages = false;
    render();
    scrollMessagesToBottom();
  }
}

async function ensureAdminData() {
  if (!state.user?.canAccessSettings) {
    return;
  }

  state.loadingAdmin = true;
  render();

  try {
    const [settingsResponse, usersResponse] = await Promise.all([
      api("/api/settings"),
      api("/api/users"),
    ]);
    state.settings = settingsResponse.settings;
    state.users = usersResponse.users || [];
  } catch (error) {
    pushToast("Nao foi possivel carregar a administracao.", error.message, "error");
  } finally {
    state.loadingAdmin = false;
    render();
  }
}

function render() {
  app.innerHTML = `
    <div class="screen">
      ${state.user ? renderAppShell() : renderLoginScreen()}
      ${renderToasts()}
    </div>
  `;

  bindEvents();
}

function renderLoginScreen() {
  return `
    <div class="login-shell">
      <section class="hero-panel">
        <span class="hero-tag">Workspace privado com IA, codigo e imagem</span>
        <h1 class="hero-title">Uma plataforma privada de IA com controlo centralizado e execução profissional.</h1>
        <p class="hero-copy">
          Acesso seguro por utilizador e palavra-passe, gestão centralizada da conta OpenAI, conversas privadas por utilizador e uma área administrativa dedicada à configuração, governação e controlo operacional da aplicação.
        </p>
        <div class="hero-grid">
          <div class="hero-stat">
            <strong>Codigo</strong>
            <span>Gera software, corrige bugs e recria interfaces a partir de screenshots.</span>
          </div>
          <div class="hero-stat">
            <strong>Imagem</strong>
            <span>Gera e edita imagens com foco em realismo, detalhe e acabamento premium.</span>
          </div>
          <div class="hero-stat">
            <strong>Admin</strong>
            <span>Apenas o utilizador principal pode gerir modelos, chave e acessos.</span>
          </div>
        </div>
      </section>

      <section class="auth-panel">
        <div class="brand-row">
          <div class="brand-mark">PC</div>
          <span class="chip">Multimodal privado</span>
        </div>
        <div class="helper-text" style="margin-bottom:10px;">${APP_SIGNATURE}</div>
        <h2 class="panel-title">Entrar na plataforma</h2>
        <p class="panel-copy">
          O chat suporta texto, anexos, geracao de codigo, imagem realista e mudanca automatica de modo conforme o pedido.
        </p>

        <form id="login-form" class="stack">
          <div class="field">
            <label for="login-username">Utilizador</label>
            <input id="login-username" class="input" name="username" autocomplete="username" required />
          </div>
          <div class="field">
            <label for="login-password">Palavra-passe</label>
            <input id="login-password" class="input" name="password" type="password" autocomplete="current-password" required />
          </div>
          ${
            state.loginError
              ? `<div class="error-text">${escapeHtml(state.loginError)}</div>`
              : ``
          }
          <button class="button button-primary" type="submit" ${state.authenticating ? "disabled" : ""}>
            ${state.authenticating ? `<span class="spinner"></span> A autenticar...` : "Entrar"}
          </button>
        </form>
      </section>
    </div>
  `;
}

function renderAppShell() {
  return `
    <div class="app-shell ${state.mobileSidebarOpen ? "mobile-sidebar-open" : ""}">
      <button
        type="button"
        id="sidebar-backdrop"
        class="sidebar-backdrop"
        aria-label="Fechar menu lateral"
      ></button>
      <aside class="shell-sidebar">
        <div>
          <div class="sidebar-header">
            <div>
              <h2 class="sidebar-title">${APP_NAME}</h2>
              <div class="profile-meta" style="margin-top:4px;">${APP_SIGNATURE}</div>
              <p class="sidebar-copy">Assistente privado com texto, codigo e imagem.</p>
            </div>
            <div class="sidebar-header-actions">
              <span class="hero-tag">Online</span>
              <button
                type="button"
                id="close-sidebar-button"
                class="icon-button sidebar-close-button"
                aria-label="Fechar menu"
              >
                X
              </button>
            </div>
          </div>

          <div class="sidebar-actions" style="margin-top:18px;">
            <button id="new-chat-button" class="button button-primary">Nova conversa</button>
          </div>
        </div>

        <div class="chat-list">
          ${
            state.loadingChats
              ? `<div class="glass-card" style="padding:18px;"><span class="loading-inline"><span class="spinner"></span> A carregar conversas...</span></div>`
              : state.chats.length
                ? state.chats.map(renderChatItem).join("")
                : `
                  <div class="glass-card" style="padding:18px;">
                    <strong>Ainda sem conversas</strong>
                    <p class="helper-text">Cria a primeira conversa para comecares a usar a aplicacao.</p>
                  </div>
                `
          }
        </div>

        <div class="sidebar-footer">
          <div class="profile-card">
            <div class="avatar">${escapeHtml(initialsFor(state.user.displayName || state.user.username))}</div>
            <div>
              <div class="profile-name">${escapeHtml(state.user.displayName)}</div>
              <div class="profile-meta">@${escapeHtml(state.user.username)}</div>
            </div>
          </div>
          <div class="sidebar-actions">
            ${
              state.user.canAccessSettings
                ? `<button class="button ${state.view === "settings" ? "button-primary" : "button-secondary"}" id="open-settings-button">Configuracoes</button>`
                : ""
            }
            <button class="button button-ghost" id="logout-button">Sair</button>
          </div>
        </div>
      </aside>

      <section class="shell-main">
        <header class="main-header">
          <div class="main-header-left">
            <button
              type="button"
              id="open-sidebar-button"
              class="icon-button mobile-nav-button"
              aria-label="Abrir menu"
            >
              Chats
            </button>
            <div class="header-tabs">
              <button class="tab-button ${state.view === "chat" ? "active" : ""}" id="chat-tab-button">Chat</button>
              ${
                state.user.canAccessSettings
                  ? `<button class="tab-button ${state.view === "settings" ? "active" : ""}" id="settings-tab-button">Administracao</button>`
                  : ""
              }
            </div>
          </div>
          <div class="chat-meta">${state.user.canAccessSettings ? "Administrador principal" : "Utilizador autenticado"}</div>
        </header>

        <div class="main-content">
          ${state.view === "settings" ? renderSettingsView() : renderChatView()}
        </div>
      </section>
    </div>
  `;
}

function renderChatItem(chat) {
  return `
    <button class="chat-item ${chat.id === state.activeChatId ? "active" : ""}" data-chat-id="${chat.id}">
      <strong>${escapeHtml(chat.title)}</strong>
      <span>${escapeHtml(chat.preview || "Sem mensagens")}</span>
      <span style="margin-top:10px;">${formatDate(chat.updatedAt)}</span>
    </button>
  `;
}

function renderChatView() {
  const publicSettings = getPublicSettings();
  const effectiveAutoMode = detectAutoMode(state.composerText, state.composerAttachments);
  const visibleMode = state.composerMode === "auto" ? effectiveAutoMode : state.composerMode;
  const imageModeNote = getImageModeNote(publicSettings.imageOutputModel);
  const activeChat = state.chats.find((chat) => chat.id === state.activeChatId) || null;
  const messageCountLabel =
    state.messages.length === 1 ? "1 mensagem" : `${state.messages.length} mensagens`;

  if (!state.activeChatId && state.chats.length === 0) {
    return `
      <div class="chat-welcome">
        <div class="welcome-card">
          <span class="hero-tag">Experiencia multimodal</span>
          <h2 class="section-title">Pronto para criar</h2>
          <p class="section-copy">
            Usa o modo Auto para a app escolher entre assistente, codigo ou imagem, ou seleciona manualmente quando quiseres controlar o resultado.
          </p>
          <div class="suggestions">
            ${renderPresetButton(PRESETS.auto[0])}
            ${renderPresetButton(PRESETS.auto[1])}
            ${renderPresetButton(PRESETS.auto[2])}
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="chat-screen">
      <div class="mobile-chat-context">
        <strong>${escapeHtml(activeChat?.title || "Nova conversa")}</strong>
        <span>${escapeHtml(activeChat ? messageCountLabel : "Sem mensagens ainda")}</span>
      </div>

      <div id="message-feed" class="message-feed">
        ${
          state.loadingMessages
            ? `<div class="empty-card"><span class="loading-inline"><span class="spinner"></span> A abrir a conversa...</span></div>`
            : state.messages.length
              ? state.messages.map(renderMessage).join("")
              : `
                <div class="empty-card">
                  <span class="hero-tag">Conversa vazia</span>
                  <h3 class="section-title" style="font-size:24px;margin-top:14px;">Escolhe um modo e envia o primeiro pedido.</h3>
                  <p class="section-copy">Podes pedir codigo, gerar uma imagem realista ou transformar uma screenshot em HTML/CSS.</p>
                </div>
              `
        }
      </div>

      <div class="composer-wrap">
        <form id="composer-form" class="composer">
          <div class="composer-head">
            <div class="mode-switcher">
              ${renderModeButton("auto")}
              ${renderModeButton("assistant")}
              ${renderModeButton("code")}
              ${renderModeButton("image")}
            </div>
            <div class="chat-meta">
              ${
                state.composerMode === "auto"
                  ? `Auto -> ${MODE_META[effectiveAutoMode].label}`
                  : `${MODE_META[visibleMode].label} -> ${escapeHtml(resolveModelForMode(visibleMode, publicSettings))}`
              }
            </div>
          </div>

          <div class="helper-text composer-guidance">
            ${escapeHtml(MODE_META[state.composerMode].hint)}
            ${
              state.composerMode === "auto"
                ? ` Agora mesmo, o pedido parece cair em ${MODE_META[effectiveAutoMode].label}.`
                : ""
            }
          </div>

          <div class="preset-row">
            ${getPresetsForComposer().map(renderPresetButton).join("")}
          </div>

          <textarea
            id="composer-textarea"
            placeholder="${escapeAttribute(getComposerPlaceholder(visibleMode, state.composerMode === "auto"))}"
          >${escapeHtml(state.composerText)}</textarea>

          ${
            state.composerAttachments.length
              ? `
                <div class="attachment-strip">
                  ${state.composerAttachments.map(renderPendingAttachment).join("")}
                </div>
              `
              : ""
          }

          <div class="composer-actions">
            <div class="sidebar-actions">
              <label class="button button-secondary" for="attachment-input">Adicionar anexos</label>
              <input id="attachment-input" class="hidden-input" type="file" multiple />
              ${
                state.activeChatId
                  ? `<button type="button" class="button button-ghost" id="delete-chat-button">Apagar conversa</button>`
                  : ""
              }
            </div>
            <button class="button button-primary" type="submit" ${state.pendingMessage ? "disabled" : ""}>
              ${
                state.pendingMessage
                  ? `<span class="spinner"></span> ${escapeHtml(getPendingLabel(visibleMode))}`
                  : "Enviar"
              }
            </button>
          </div>

          <div class="helper-text composer-footnote">
            Suporta ate 4 anexos por mensagem. Para gerar HTML/CSS a partir de uma imagem, usa o modo <strong>Codigo</strong> ou deixa em <strong>Auto</strong>. ${escapeHtml(imageModeNote)}
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderModeButton(mode) {
  return `
    <button
      type="button"
      class="mode-button ${state.composerMode === mode ? "active" : ""}"
      data-mode-button="${mode}"
    >
      ${MODE_META[mode].label}
    </button>
  `;
}

function renderPresetButton(preset) {
  return `
    <button
      type="button"
      class="preset-button"
      data-preset-id="${preset.id}"
      data-preset-mode="${preset.mode}"
    >
      ${escapeHtml(preset.label)}
    </button>
  `;
}

function renderMessage(message) {
  const roleLabel = message.role === "user" ? "Tu" : "Assistente";
  const dimmed = message.status === "failed" ? "dimmed" : "";

  return `
    <article class="message-row ${message.role}">
      <div class="message-bubble">
        <div class="message-head">
          <span class="message-role">${roleLabel}</span>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="mini-badge">${escapeHtml(modeBadgeLabel(message.mode))}</span>
            <span class="message-time">${formatDateTime(message.createdAt)}</span>
          </div>
        </div>
        ${
          message.model
            ? `<div class="helper-text" style="margin-bottom:10px;">Modelo: ${escapeHtml(message.model)}</div>`
            : ""
        }
        <div class="message-text ${dimmed}">${renderRichText(message.text || "")}</div>
        ${
          message.attachments?.length
            ? `<div class="attachments">${message.attachments.map(renderSavedAttachment).join("")}</div>`
            : ""
        }
      </div>
    </article>
  `;
}

function renderSavedAttachment(attachment) {
  const isImage = attachment.kind === "image" || attachment.kind === "generated-image";
  const className = attachment.kind === "generated-image"
    ? "attachment-card generated-image-card"
    : "attachment-card";

  const preview = isImage
    ? `<img src="${attachment.url}" alt="${escapeHtml(attachment.name)}" />`
    : `<div class="avatar" style="width:52px;height:52px;border-radius:12px;">${escapeHtml(iconForAttachment(attachment.name))}</div>`;

  return `
    <a class="${className}" href="${attachment.url}" target="_blank" rel="noreferrer">
      ${preview}
      <div class="attachment-details">
        <div class="attachment-name">${escapeHtml(attachment.name)}</div>
        <div class="attachment-meta">${formatBytes(attachment.size)}</div>
      </div>
    </a>
  `;
}

function renderPendingAttachment(attachment, index) {
  return `
    <div class="attachment-pill">
      <span>${escapeHtml(attachment.name)}</span>
      <button type="button" data-remove-attachment="${index}" aria-label="Remover anexo">x</button>
    </div>
  `;
}

function renderSettingsView() {
  if (!state.user?.canAccessSettings) {
    return `
      <div class="empty-state">
        <div class="empty-card">
          <h2 class="section-title">Acesso restrito</h2>
          <p class="section-copy">Esta area esta reservada ao utilizador administrador principal.</p>
        </div>
      </div>
    `;
  }

  if (state.loadingAdmin && !state.settings) {
    return `
      <div class="empty-state">
        <div class="empty-card">
          <span class="loading-inline"><span class="spinner"></span> A carregar configuracao...</span>
        </div>
      </div>
    `;
  }

  const settings = {
    assistantName: APP_NAME,
    defaultModel: "gpt-5.5",
    codeModel: "gpt-5.5",
    imageOutputModel: "dall-e-3",
    systemPrompt: "",
    codeSystemPrompt: "",
    imageSystemPrompt: "",
    reasoningEffort: "medium",
    maxOutputTokens: 4000,
    imageSize: "1024x1024",
    imageQuality: "hd",
    maskedApiKey: "Nao definida",
    hasApiKey: false,
    storagePath: "",
    usesExternalStorage: false,
    ...(state.settings || {}),
  };
  const imageModelProfile = getImageModelProfile(settings.imageOutputModel);
  const imageModelHelper = getImageModelHelperText(settings.imageOutputModel);

  return `
    <div class="settings-grid">
      <section>
        <span class="hero-tag">Conta OpenAI e modos</span>
        <h2 class="section-title">Parametros da experiencia</h2>
        <p class="section-copy">
          Sugestao atual baseada nas docs oficiais: <strong>gpt-5.5</strong> para assistente e codigo, e <strong>dall-e-3</strong> como fallback compativel para geracao de imagem sem depender do bloqueio dos modelos GPT Image. Assim que a organizacao OpenAI estiver verificada, o mais robusto e voltar para um modelo GPT Image.
        </p>
        <div class="storage-banner ${settings.usesExternalStorage ? "is-external" : ""}">
          <strong>${settings.usesExternalStorage ? "Persistencia preparada" : "Persistencia local"}</strong>
          <span>${escapeHtml(settings.storagePath || "Diretorio nao identificado.")}</span>
        </div>

        <form id="settings-form" class="stack">
          <div class="form-grid">
            <div class="field">
              <label for="assistant-name">Nome do assistente</label>
              <input id="assistant-name" class="input" name="assistantName" value="${escapeAttribute(settings.assistantName)}" />
            </div>
            <div class="field">
              <label for="default-model">Modelo do assistente</label>
              <input id="default-model" class="input" name="defaultModel" value="${escapeAttribute(settings.defaultModel)}" />
            </div>
            <div class="field">
              <label for="code-model">Modelo de codigo</label>
              <input id="code-model" class="input" name="codeModel" value="${escapeAttribute(settings.codeModel)}" />
            </div>
            <div class="field">
              <label for="image-output-model">Modelo de imagem</label>
              <input id="image-output-model" class="input" name="imageOutputModel" list="image-model-options" value="${escapeAttribute(settings.imageOutputModel)}" />
              <datalist id="image-model-options">
                <option value="dall-e-3"></option>
                <option value="dall-e-2"></option>
                <option value="gpt-image-2"></option>
                <option value="gpt-image-1.5"></option>
                <option value="gpt-image-1-mini"></option>
              </datalist>
              <div class="helper-text">${escapeHtml(imageModelHelper)}</div>
            </div>
            <div class="field">
              <label for="reasoning-effort">Esforco de raciocinio</label>
              <select id="reasoning-effort" class="select" name="reasoningEffort">
                ${["minimal", "low", "medium", "high", "xhigh"].map((value) => `
                  <option value="${value}" ${settings.reasoningEffort === value ? "selected" : ""}>${value}</option>
                `).join("")}
              </select>
            </div>
            <div class="field">
              <label for="max-output-tokens">Max output tokens</label>
              <input id="max-output-tokens" class="input" name="maxOutputTokens" type="number" min="256" max="12000" value="${escapeAttribute(String(settings.maxOutputTokens || 4000))}" />
            </div>
            <div class="field">
              <label for="image-size">Tamanho da imagem</label>
              <select id="image-size" class="select" name="imageSize">
                ${imageModelProfile.sizes.map((value) => `
                  <option value="${value}" ${settings.imageSize === value ? "selected" : ""}>${value}</option>
                `).join("")}
              </select>
            </div>
            <div class="field">
              <label for="image-quality">Qualidade da imagem</label>
              <select id="image-quality" class="select" name="imageQuality">
                ${imageModelProfile.qualities.map((value) => `
                  <option value="${value}" ${settings.imageQuality === value ? "selected" : ""}>${value}</option>
                `).join("")}
              </select>
            </div>
            <div class="field wide">
              <label for="system-prompt">Prompt base do assistente</label>
              <textarea id="system-prompt" class="textarea" name="systemPrompt">${escapeHtml(settings.systemPrompt || "")}</textarea>
            </div>
            <div class="field wide">
              <label for="code-system-prompt">Prompt do modo codigo</label>
              <textarea id="code-system-prompt" class="textarea" name="codeSystemPrompt">${escapeHtml(settings.codeSystemPrompt || "")}</textarea>
            </div>
            <div class="field wide">
              <label for="image-system-prompt">Prompt do modo imagem</label>
              <textarea id="image-system-prompt" class="textarea" name="imageSystemPrompt">${escapeHtml(settings.imageSystemPrompt || "")}</textarea>
            </div>
            <div class="field wide">
              <label for="api-key">API key OpenAI</label>
              <input id="api-key" class="input" name="openAiApiKey" type="password" placeholder="Deixa vazio para manter a chave atual" />
              <div class="helper-text">
                Estado atual: <strong>${settings.hasApiKey ? escapeHtml(settings.maskedApiKey) : "Nao definida"}</strong>
              </div>
            </div>
          </div>

          <div class="sidebar-actions">
            <button class="button button-primary" type="submit" ${state.savingSettings ? "disabled" : ""}>
              ${state.savingSettings ? `<span class="spinner"></span> A guardar...` : "Guardar configuracoes"}
            </button>
          </div>
        </form>
      </section>

      <section>
        <span class="hero-tag">Gestao de utilizadores</span>
        <h2 class="section-title">Acessos a aplicacao</h2>
        <p class="section-copy">
          O utilizador <strong>ramoscv</strong> mantem acesso exclusivo a configuracoes. Os restantes utilizadores entram apenas na experiencia de chat.
        </p>

        <div class="users-list">
          ${state.users.map(renderUserRow).join("")}
        </div>

        <form id="new-user-form" class="stack">
          <div class="field">
            <label for="new-display-name">Nome</label>
            <input id="new-display-name" class="input" name="displayName" required />
          </div>
          <div class="field">
            <label for="new-username">Utilizador</label>
            <input id="new-username" class="input" name="username" required />
          </div>
          <div class="field">
            <label for="new-password">Palavra-passe</label>
            <input id="new-password" class="input" name="password" type="password" required />
          </div>
          <button class="button button-secondary" type="submit" ${state.creatingUser ? "disabled" : ""}>
            ${state.creatingUser ? `<span class="spinner"></span> A criar...` : "Criar utilizador"}
          </button>
        </form>
      </section>
    </div>
  `;
}

function renderUserRow(user) {
  return `
    <div class="user-row">
      <div class="user-top">
        <div>
          <strong>${escapeHtml(user.displayName)}</strong>
          <div class="user-meta">@${escapeHtml(user.username)}</div>
        </div>
        <span class="status-badge ${user.active ? "active" : "inactive"}">
          ${user.isSuperAdmin ? "Super admin" : user.active ? "Ativo" : "Inativo"}
        </span>
      </div>
      <div class="user-actions">
        ${
          !user.isSuperAdmin
            ? `
              <button class="button button-secondary" type="button" data-toggle-user="${user.id}">
                ${user.active ? "Desativar" : "Ativar"}
              </button>
              <button class="button button-secondary" type="button" data-reset-password="${user.id}">
                Repor password
              </button>
              <button class="button button-danger" type="button" data-delete-user="${user.id}">
                Apagar
              </button>
            `
            : `<span class="helper-text">Acesso administrativo fixo.</span>`
        }
      </div>
    </div>
  `;
}

function renderToasts() {
  if (!state.toasts.length) {
    return "";
  }

  return `
    <div class="toast-stack">
      ${state.toasts.map((toast) => `
        <div class="toast ${toast.type}">
          <div class="toast-title">${escapeHtml(toast.title)}</div>
          <div>${escapeHtml(toast.description)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function bindEvents() {
  const loginForm = document.querySelector("#login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLoginSubmit);
  }

  const newChatButton = document.querySelector("#new-chat-button");
  if (newChatButton) {
    newChatButton.addEventListener("click", handleNewChat);
  }

  const openSidebarButton = document.querySelector("#open-sidebar-button");
  if (openSidebarButton) {
    openSidebarButton.addEventListener("click", openMobileSidebar);
  }

  const closeSidebarButton = document.querySelector("#close-sidebar-button");
  if (closeSidebarButton) {
    closeSidebarButton.addEventListener("click", closeMobileSidebar);
  }

  const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener("click", closeMobileSidebar);
  }

  const logoutButton = document.querySelector("#logout-button");
  if (logoutButton) {
    logoutButton.addEventListener("click", handleLogout);
  }

  const chatTabButton = document.querySelector("#chat-tab-button");
  if (chatTabButton) {
    chatTabButton.addEventListener("click", () => {
      state.view = "chat";
      closeMobileSidebar();
      render();
    });
  }

  const openSettingsButton = document.querySelector("#open-settings-button");
  if (openSettingsButton) {
    openSettingsButton.addEventListener("click", async () => {
      state.view = "settings";
      closeMobileSidebar();
      render();
      await ensureAdminData();
    });
  }

  const settingsTabButton = document.querySelector("#settings-tab-button");
  if (settingsTabButton) {
    settingsTabButton.addEventListener("click", async () => {
      state.view = "settings";
      closeMobileSidebar();
      render();
      await ensureAdminData();
    });
  }

  document.querySelectorAll("[data-chat-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await loadMessages(button.dataset.chatId);
      closeMobileSidebar();
    });
  });

  document.querySelectorAll("[data-mode-button]").forEach((button) => {
    button.addEventListener("click", () => {
      state.composerMode = button.dataset.modeButton;
      render();
    });
  });

  document.querySelectorAll("[data-preset-id]").forEach((button) => {
    button.addEventListener("click", () => {
      applyPreset(button.dataset.presetId, button.dataset.presetMode);
    });
  });

  const composerTextarea = document.querySelector("#composer-textarea");
  if (composerTextarea) {
    composerTextarea.addEventListener("input", (event) => {
      state.composerText = event.target.value;
      if (state.composerMode === "auto") {
        updateModeSummaryMeta();
      }
    });

    composerTextarea.addEventListener("keydown", (event) => {
      const isEnterKey =
        event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter";

      if (event.ctrlKey && isEnterKey) {
        event.preventDefault();
        submitComposerForm();
      }
    });
  }

  const composerForm = document.querySelector("#composer-form");
  if (composerForm) {
    composerForm.addEventListener("submit", handleSendMessage);
  }

  const attachmentInput = document.querySelector("#attachment-input");
  if (attachmentInput) {
    attachmentInput.addEventListener("change", handleAttachmentSelection);
  }

  document.querySelectorAll("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeAttachment);
      state.composerAttachments.splice(index, 1);
      render();
    });
  });

  const deleteChatButton = document.querySelector("#delete-chat-button");
  if (deleteChatButton) {
    deleteChatButton.addEventListener("click", handleDeleteChat);
  }

  const settingsForm = document.querySelector("#settings-form");
  if (settingsForm) {
    settingsForm.addEventListener("submit", handleSaveSettings);
  }

  const newUserForm = document.querySelector("#new-user-form");
  if (newUserForm) {
    newUserForm.addEventListener("submit", handleCreateUser);
  }

  document.querySelectorAll("[data-toggle-user]").forEach((button) => {
    button.addEventListener("click", () => handleToggleUser(button.dataset.toggleUser));
  });

  document.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", () => handleDeleteUser(button.dataset.deleteUser));
  });

  document.querySelectorAll("[data-reset-password]").forEach((button) => {
    button.addEventListener("click", () => handleResetPassword(button.dataset.resetPassword));
  });
}

function bindGlobalEvents() {
  window.addEventListener("resize", handleViewportResize, { passive: true });
}

function handleViewportResize() {
  if (!isMobileViewport() && state.mobileSidebarOpen) {
    state.mobileSidebarOpen = false;
    render();
  }
}

function updateModeSummaryMeta() {
  const chatMeta = document.querySelector(".composer .chat-meta");
  if (!chatMeta) {
    return;
  }

  if (state.composerMode !== "auto") {
    return;
  }

  const effective = detectAutoMode(state.composerText, state.composerAttachments);
  chatMeta.textContent = `Auto -> ${MODE_META[effective].label}`;
}

function submitComposerForm() {
  const form = document.querySelector("#composer-form");
  if (!form) {
    return;
  }

  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
    return;
  }

  form.dispatchEvent(
    new Event("submit", {
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.authenticating = true;
  state.loginError = "";
  render();

  try {
    const response = await api("/api/auth/login", {
      method: "POST",
      body: {
        username: form.get("username"),
        password: form.get("password"),
      },
    });
    state.user = response.user;
    state.settings = { ...(state.settings || {}), ...(response.appConfig || {}) };
    state.view = "chat";
    state.composerText = "";
    state.composerAttachments = [];
    state.composerMode = "auto";
    state.mobileSidebarOpen = false;
    await loadChats();
    pushToast("Sessao iniciada", "Bem-vindo a plataforma.", "info");
  } catch (error) {
    state.loginError = error.message;
  } finally {
    state.authenticating = false;
    render();
  }
}

async function handleLogout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // noop
  }

  Object.assign(state, {
    user: null,
    chats: [],
    activeChatId: null,
    messages: [],
    view: "chat",
    composerText: "",
    composerAttachments: [],
    composerMode: "auto",
    mobileSidebarOpen: false,
    settings: null,
    users: [],
    loginError: "",
  });
  render();
}

async function handleNewChat() {
  try {
    const response = await api("/api/chats", {
      method: "POST",
      body: { title: "Nova conversa" },
    });
    state.chats = [response.chat, ...state.chats];
    state.activeChatId = response.chat.id;
    state.messages = [];
    state.view = "chat";
    state.composerMode = "auto";
    closeMobileSidebar();
    render();
  } catch (error) {
    pushToast("Nao foi possivel criar a conversa.", error.message, "error");
  }
}

async function handleSendMessage(event) {
  event.preventDefault();
  if (state.pendingMessage) {
    return;
  }

  let chatId = state.activeChatId;
  if (!chatId) {
    try {
      const response = await api("/api/chats", {
        method: "POST",
        body: { title: "Nova conversa" },
      });
      state.chats = [response.chat, ...state.chats];
      state.activeChatId = response.chat.id;
      chatId = response.chat.id;
    } catch (error) {
      pushToast("Nao foi possivel preparar a conversa.", error.message, "error");
      return;
    }
  }

  const text = state.composerText.trim();
  const attachments = [...state.composerAttachments];
  if (!text && attachments.length === 0) {
    pushToast("Mensagem vazia", "Escreve uma mensagem ou junta pelo menos um anexo.", "error");
    return;
  }

  const requestedMode = state.composerMode;
  const effectiveMode = requestedMode === "auto"
    ? detectAutoMode(text, attachments)
    : requestedMode;

  state.pendingMessage = true;
  state.composerText = "";
  state.composerAttachments = [];

  const optimisticUserMessage = {
    id: `temp-user-${Date.now()}`,
    role: "user",
    mode: effectiveMode,
    text,
    status: "sending",
    createdAt: new Date().toISOString(),
    attachments: attachments.map((attachment, index) => ({
      id: `temp-${index}`,
      name: attachment.name,
      size: attachment.size,
      kind: attachment.type.startsWith("image/") ? "image" : "file",
      url: attachment.dataUrl,
    })),
  };

  const optimisticAssistantMessage = {
    id: `temp-assistant-${Date.now()}`,
    role: "assistant",
    mode: effectiveMode,
    text: getOptimisticAssistantText(effectiveMode),
    status: "sending",
    createdAt: new Date().toISOString(),
    attachments: [],
  };

  state.messages = [...state.messages, optimisticUserMessage, optimisticAssistantMessage];
  render();
  scrollMessagesToBottom();

  try {
    const response = await api(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: {
        text,
        attachments,
        mode: requestedMode,
      },
    });

    state.messages = state.messages.filter((message) => !String(message.id).startsWith("temp-"));
    state.messages.push(response.userMessage, response.assistantMessage);
    upsertChat(response.chat);
    state.activeChatId = response.chat.id;
    if (response.warning) {
      pushToast("Resposta devolvida com aviso", response.warning, "error");
    }
  } catch (error) {
    state.messages = state.messages.filter((message) => !String(message.id).startsWith("temp-"));
    state.composerText = text;
    state.composerAttachments = attachments;
    pushToast("Nao foi possivel enviar a mensagem.", error.message, "error");
  } finally {
    state.pendingMessage = false;
    render();
    scrollMessagesToBottom();
  }
}

async function handleAttachmentSelection(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";

  if (!files.length) {
    return;
  }

  if (state.composerAttachments.length + files.length > 4) {
    pushToast("Limite de anexos", "Podes manter no maximo 4 anexos por mensagem.", "error");
    return;
  }

  try {
    const converted = await Promise.all(files.map(fileToDataUrl));
    state.composerAttachments.push(...converted);
    render();
  } catch (error) {
    pushToast("Falha ao anexar ficheiro", error.message, "error");
  }
}

async function handleDeleteChat() {
  if (!state.activeChatId) {
    return;
  }

  const confirmed = window.confirm("Queres apagar esta conversa de forma permanente?");
  if (!confirmed) {
    return;
  }

  try {
    await api(`/api/chats/${state.activeChatId}`, { method: "DELETE" });
    state.chats = state.chats.filter((chat) => chat.id !== state.activeChatId);
    state.activeChatId = state.chats[0]?.id || null;
    if (state.activeChatId) {
      await loadMessages(state.activeChatId);
    } else {
      state.messages = [];
      render();
    }
    pushToast("Conversa apagada", "A conversa foi removida da aplicacao.", "info");
  } catch (error) {
    pushToast("Nao foi possivel apagar a conversa.", error.message, "error");
  }
}

async function handleSaveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.savingSettings = true;
  render();

  try {
    const response = await api("/api/settings", {
      method: "PUT",
      body: {
        assistantName: form.get("assistantName"),
        defaultModel: form.get("defaultModel"),
        codeModel: form.get("codeModel"),
        imageOutputModel: form.get("imageOutputModel"),
        systemPrompt: form.get("systemPrompt"),
        codeSystemPrompt: form.get("codeSystemPrompt"),
        imageSystemPrompt: form.get("imageSystemPrompt"),
        openAiApiKey: form.get("openAiApiKey"),
        reasoningEffort: form.get("reasoningEffort"),
        maxOutputTokens: Number(form.get("maxOutputTokens")),
        imageSize: form.get("imageSize"),
        imageQuality: form.get("imageQuality"),
      },
    });
    state.settings = response.settings;
    pushToast("Configuracoes guardadas", "A parametrizacao da OpenAI foi atualizada.", "info");
  } catch (error) {
    pushToast("Falha ao guardar", error.message, "error");
  } finally {
    state.savingSettings = false;
    render();
  }
}

async function handleCreateUser(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.creatingUser = true;
  render();

  try {
    const response = await api("/api/users", {
      method: "POST",
      body: {
        displayName: form.get("displayName"),
        username: form.get("username"),
        password: form.get("password"),
      },
    });
    state.users = [...state.users, response.user];
    event.currentTarget.reset();
    pushToast("Utilizador criado", `${response.user.displayName} ja pode iniciar sessao.`, "info");
  } catch (error) {
    pushToast("Nao foi possivel criar o utilizador.", error.message, "error");
  } finally {
    state.creatingUser = false;
    render();
  }
}

async function handleToggleUser(userId) {
  const user = state.users.find((entry) => entry.id === userId);
  if (!user) {
    return;
  }

  try {
    const response = await api(`/api/users/${userId}`, {
      method: "PUT",
      body: {
        active: !user.active,
      },
    });
    state.users = state.users.map((entry) => (entry.id === userId ? response.user : entry));
    pushToast("Utilizador atualizado", `${response.user.displayName} foi atualizado.`, "info");
    render();
  } catch (error) {
    pushToast("Nao foi possivel atualizar o utilizador.", error.message, "error");
  }
}

async function handleDeleteUser(userId) {
  const user = state.users.find((entry) => entry.id === userId);
  if (!user) {
    return;
  }

  const confirmed = window.confirm(`Apagar o utilizador ${user.displayName} e as suas conversas?`);
  if (!confirmed) {
    return;
  }

  try {
    await api(`/api/users/${userId}`, { method: "DELETE" });
    state.users = state.users.filter((entry) => entry.id !== userId);
    pushToast("Utilizador removido", "O acesso e os dados do utilizador foram eliminados.", "info");
    render();
  } catch (error) {
    pushToast("Nao foi possivel apagar o utilizador.", error.message, "error");
  }
}

async function handleResetPassword(userId) {
  const user = state.users.find((entry) => entry.id === userId);
  if (!user) {
    return;
  }

  const newPassword = window.prompt(`Nova palavra-passe para ${user.displayName}:`);
  if (!newPassword) {
    return;
  }

  try {
    const response = await api(`/api/users/${userId}`, {
      method: "PUT",
      body: {
        password: newPassword,
      },
    });
    state.users = state.users.map((entry) => (entry.id === userId ? response.user : entry));
    pushToast("Password reposta", `A palavra-passe de ${response.user.displayName} foi atualizada.`, "info");
    render();
  } catch (error) {
    pushToast("Nao foi possivel repor a password.", error.message, "error");
  }
}

function pushToast(title, description, type = "info") {
  state.toasts = [...state.toasts, { id: crypto.randomUUID(), title, description, type }];
  render();
  setTimeout(() => {
    state.toasts = state.toasts.slice(1);
    render();
  }, 3200);
}

function upsertChat(chat) {
  const existingIndex = state.chats.findIndex((entry) => entry.id === chat.id);
  if (existingIndex === -1) {
    state.chats = [chat, ...state.chats];
    return;
  }

  state.chats[existingIndex] = chat;
  state.chats = [...state.chats].sort(
    (left, right) => new Date(right.updatedAt) - new Date(left.updatedAt),
  );
}

function applyPreset(presetId, presetMode) {
  const allPresets = [
    ...PRESETS.auto,
    ...PRESETS.assistant,
    ...PRESETS.code,
    ...PRESETS.image,
  ];
  const preset = allPresets.find((entry) => entry.id === presetId);
  if (!preset) {
    return;
  }

  state.composerMode = presetMode || preset.mode || state.composerMode;
  state.composerText = state.composerText.trim()
    ? `${state.composerText.trim()}\n\n${preset.prompt}`
    : preset.prompt;
  render();

  const textarea = document.querySelector("#composer-textarea");
  if (textarea) {
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }
}

function getPresetsForComposer() {
  const presets = PRESETS[state.composerMode] || PRESETS.auto;
  if (state.composerMode === "image" && !supportsImageEditing(getPublicSettings().imageOutputModel)) {
    return presets.filter((preset) => preset.id !== "image-edit");
  }
  return presets;
}

function getComposerPlaceholder(visibleMode, isAuto) {
  if (isAuto) {
    return "Escreve o pedido. A app pode mudar automaticamente para codigo ou imagem conforme o contexto...";
  }

  if (visibleMode === "code") {
    return "Pede codigo de software, cola um bug, ou anexa uma imagem para gerar HTML/CSS...";
  }

  if (visibleMode === "image") {
    return "Descreve a imagem que queres gerar ou anexa uma imagem para editar e melhorar...";
  }

  return "Escreve a tua mensagem, analisa anexos, resume documentos ou pede apoio geral...";
}

function getPendingLabel(mode) {
  if (mode === "code") {
    return "A escrever codigo...";
  }
  if (mode === "image") {
    return "A gerar imagem...";
  }
  return "A responder...";
}

function getOptimisticAssistantText(mode) {
  if (mode === "code") {
    return "A preparar uma resposta tecnica e codigo pronto a usar...";
  }
  if (mode === "image") {
    return "A gerar ou editar a imagem...";
  }
  return "A gerar resposta...";
}

function getPublicSettings() {
  return {
    assistantName: APP_NAME,
    defaultModel: "gpt-5.5",
    codeModel: "gpt-5.5",
    imageOutputModel: "dall-e-3",
    imageQuality: "hd",
    imageSize: "1024x1024",
    ...(state.settings || {}),
  };
}

function normalizeImageModelIdentifier(value) {
  return String(value || "").trim().toLowerCase() || "dall-e-3";
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

function getImageModelProfile(model) {
  const family = getImageModelFamily(model);

  if (family === "dall-e-3") {
    return {
      family,
      supportsEdits: false,
      sizes: ["1024x1024", "1024x1536", "1536x1024"],
      qualities: ["standard", "hd"],
    };
  }

  if (family === "dall-e-2") {
    return {
      family,
      supportsEdits: true,
      sizes: ["1024x1024", "1024x1536", "1536x1024"],
      qualities: ["standard"],
    };
  }

  return {
    family: "gpt-image",
    supportsEdits: true,
    sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
    qualities: ["low", "medium", "high", "auto"],
  };
}

function supportsImageEditing(model) {
  return getImageModelProfile(model).supportsEdits;
}

function getImageModelHelperText(model) {
  const normalized = normalizeImageModelIdentifier(model);
  const profile = getImageModelProfile(normalized);

  if (!profile.supportsEdits) {
    return `O modelo atual (${normalized}) gera novas imagens e serve como fallback de compatibilidade. Para edicao direta ou para uma solucao mais duradoura, usa dall-e-2 ou um modelo GPT Image depois da verificacao da organizacao.`;
  }

  if (profile.family === "gpt-image") {
    return `O modelo atual (${normalized}) suporta geracao e edicao, mas a OpenAI pode exigir verificacao da organizacao para os modelos GPT Image.`;
  }

  return `O modelo atual (${normalized}) suporta geracao e edicao de imagem.`;
}

function getImageModeNote(model) {
  if (supportsImageEditing(model)) {
    return "No modo Imagem, anexar uma imagem permite pedir uma edicao direta.";
  }

  return "No modo Imagem, o modelo atual gera imagens novas. Para editar uma imagem existente, muda o modelo de imagem para dall-e-2 ou GPT Image nas configuracoes.";
}

function resolveModelForMode(mode, settings = getPublicSettings()) {
  if (mode === "code") {
    return settings.codeModel || settings.defaultModel;
  }
  if (mode === "image") {
    return settings.imageOutputModel;
  }
  return settings.defaultModel;
}

function detectAutoMode(text, attachments) {
  const lowered = String(text || "").toLowerCase();
  const hasImageAttachment = attachments.some((attachment) =>
    String(attachment.type || attachment.mimeType || "").toLowerCase().startsWith("image/"),
  );

  const imageIntent = [
    /gera(?:r)?\s+uma?\s+imagem/,
    /cria(?:r)?\s+uma?\s+imagem/,
    /fotoreal/,
    /realistic/,
    /mockup/,
    /render/,
    /editar?\s+a?\s+imagem/,
    /melhora(?:r)?\s+o\s+realismo/,
  ];

  const codeIntent = [
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

  if (hasImageAttachment && codeIntent.some((pattern) => pattern.test(lowered))) {
    return "code";
  }

  if (imageIntent.some((pattern) => pattern.test(lowered))) {
    return "image";
  }

  if (codeIntent.some((pattern) => pattern.test(lowered))) {
    return "code";
  }

  return "assistant";
}

function modeBadgeLabel(mode) {
  return MODE_META[mode]?.label || MODE_META.assistant.label;
}

function renderRichText(text) {
  const source = String(text || "");
  if (!source) {
    return "";
  }

  const codeFencePattern = /```([\w.+-]+)?\n([\s\S]*?)```/g;
  let output = "";
  let cursor = 0;
  let match = codeFencePattern.exec(source);

  while (match) {
    output += renderParagraphSegment(source.slice(cursor, match.index));
    output += `
      <div class="code-block">
        <div class="code-header">${escapeHtml(match[1] || "code")}</div>
        <pre><code>${escapeHtml(match[2].replace(/\n$/, ""))}</code></pre>
      </div>
    `;
    cursor = match.index + match[0].length;
    match = codeFencePattern.exec(source);
  }

  output += renderParagraphSegment(source.slice(cursor));
  return output;
}

function renderParagraphSegment(segment) {
  if (!segment) {
    return "";
  }

  return segment
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error(`O ficheiro ${file.name} excede o limite de 8 MB.`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: reader.result,
      });
    };
    reader.onerror = () => reject(new Error(`Falha ao ler o ficheiro ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function initialsFor(name) {
  return String(name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function iconForAttachment(name) {
  const extension = String(name).split(".").pop()?.toUpperCase() || "FI";
  return extension.slice(0, 2);
}

function scrollMessagesToBottom() {
  requestAnimationFrame(() => {
    const feed = document.querySelector("#message-feed");
    if (feed) {
      feed.scrollTop = feed.scrollHeight;
    }
  });
}

function isMobileViewport() {
  return window.innerWidth <= MOBILE_SIDEBAR_BREAKPOINT;
}

function openMobileSidebar() {
  if (!isMobileViewport()) {
    return;
  }

  state.mobileSidebarOpen = true;
  render();
}

function closeMobileSidebar() {
  if (!state.mobileSidebarOpen) {
    return;
  }

  state.mobileSidebarOpen = false;
  render();
}
