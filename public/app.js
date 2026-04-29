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
  render();
  try {
    const response = await api("/api/me");
    if (response.user) {
      state.user = response.user;
      state.settings = { ...(state.settings || {}), ...(response.appConfig || {}) };
      await loadChats();
    }
  } catch (error) {
    pushToast("Falha ao iniciar a aplicação.", error.message, "error");
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
    pushToast("Não foi possível carregar as conversas.", error.message, "error");
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
    pushToast("Não foi possível abrir a conversa.", error.message, "error");
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
    pushToast("Não foi possível carregar a administração.", error.message, "error");
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
        <span class="hero-tag">Workspace privado com IA e anexos</span>
        <h1 class="hero-title">Uma experiência estilo ChatGPT, mas com controlo teu.</h1>
        <p class="hero-copy">
          Autenticação por utilizador e palavra-passe, gestão centralizada da chave OpenAI,
          conversas privadas por utilizador e uma área administrativa separada para configuração.
        </p>
        <div class="hero-grid">
          <div class="hero-stat">
            <strong>Chat</strong>
            <span>Conversas multi-turno com histórico local e visual moderno.</span>
          </div>
          <div class="hero-stat">
            <strong>Anexos</strong>
            <span>Imagens, PDFs e ficheiros enviados diretamente no composer.</span>
          </div>
          <div class="hero-stat">
            <strong>Admin</strong>
            <span>Apenas o utilizador principal entra nas configurações.</span>
          </div>
        </div>
      </section>

      <section class="auth-panel">
        <div class="brand-row">
          <div class="brand-mark">LC</div>
          <span class="chip">Acesso seguro e centralizado</span>
        </div>
        <h2 class="panel-title">Entrar na plataforma</h2>
        <p class="panel-copy">
          Usa as tuas credenciais para abrir o chat. O administrador principal pode também gerir utilizadores e parametrização da conta OpenAI.
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
              : `<div class="helper-text">Administrador inicial: <strong>ramoscv</strong> com a palavra-passe definida no arranque do projeto.</div>`
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
    <div class="app-shell">
      <aside class="shell-sidebar">
        <div>
          <div class="sidebar-header">
            <div>
              <h2 class="sidebar-title">Logic Chat</h2>
              <p class="sidebar-copy">Assistente privado com conversas por utilizador.</p>
            </div>
            <span class="hero-tag">Online</span>
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
                    <p class="helper-text">Cria a primeira conversa para começares a usar a aplicação.</p>
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
                ? `<button class="button ${state.view === "settings" ? "button-primary" : "button-secondary"}" id="open-settings-button">Configurações</button>`
                : ""
            }
            <button class="button button-ghost" id="logout-button">Sair</button>
          </div>
        </div>
      </aside>

      <section class="shell-main">
        <header class="main-header">
          <div>
            <div class="header-tabs">
              <button class="tab-button ${state.view === "chat" ? "active" : ""}" id="chat-tab-button">Chat</button>
              ${
                state.user.canAccessSettings
                  ? `<button class="tab-button ${state.view === "settings" ? "active" : ""}" id="settings-tab-button">Administração</button>`
                  : ""
              }
            </div>
          </div>
          <div class="chat-meta">
            ${state.user.canAccessSettings ? "Administrador principal" : "Utilizador autenticado"}
          </div>
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
  if (!state.activeChatId && state.chats.length === 0) {
    return `
      <div class="chat-welcome">
        <div class="welcome-card">
          <span class="hero-tag">Experiência de conversa privada</span>
          <h2 class="section-title">Pronto para começar</h2>
          <p class="section-copy">
            Podes escrever perguntas, pedir redações, analisar imagens ou anexar documentos. Cada utilizador vê apenas as suas próprias conversas.
          </p>
          <div class="suggestions">
            <div class="suggestion-card">
              <strong>Prompt inicial</strong>
              Cria um plano comercial para um novo serviço digital.
            </div>
            <div class="suggestion-card">
              <strong>Com anexos</strong>
              Resume este PDF e destaca os pontos de decisão.
            </div>
            <div class="suggestion-card">
              <strong>Imagem</strong>
              Analisa esta captura de ecrã e sugere melhorias de UX.
            </div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="chat-screen">
      <div id="message-feed" class="message-feed">
        ${
          state.loadingMessages
            ? `<div class="empty-card"><span class="loading-inline"><span class="spinner"></span> A abrir a conversa...</span></div>`
            : state.messages.map(renderMessage).join("")
        }
      </div>

      <div class="composer-wrap">
        <form id="composer-form" class="composer">
          <div class="chat-meta">
            Modelo atual: ${(state.settings?.defaultModel || "gpt-5.3-chat-latest")}
          </div>

          <textarea
            id="composer-textarea"
            placeholder="Escreve a tua mensagem, cola um prompt ou pede análise de anexos..."
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
              ${state.pendingMessage ? `<span class="spinner"></span> A responder...` : "Enviar"}
            </button>
          </div>

          <div class="helper-text">
            Suporta até 4 anexos por mensagem. Para melhor experiência, usa imagens, PDFs ou documentos leves.
          </div>
        </form>
      </div>
    </div>
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
          <span class="message-time">${formatDateTime(message.createdAt)}</span>
        </div>
        <div class="message-text ${dimmed}">${escapeHtml(message.text || "")}</div>
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
  const preview = attachment.kind === "image"
    ? `<img src="${attachment.url}" alt="${escapeHtml(attachment.name)}" />`
    : `<div class="avatar" style="width:52px;height:52px;border-radius:12px;">${escapeHtml(iconForAttachment(attachment.name))}</div>`;

  return `
    <a class="attachment-card" href="${attachment.url}" target="_blank" rel="noreferrer">
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
      <button type="button" data-remove-attachment="${index}" aria-label="Remover anexo">✕</button>
    </div>
  `;
}

function renderSettingsView() {
  if (!state.user?.canAccessSettings) {
    return `
      <div class="empty-state">
        <div class="empty-card">
          <h2 class="section-title">Acesso restrito</h2>
          <p class="section-copy">Esta área está reservada ao utilizador administrador principal.</p>
        </div>
      </div>
    `;
  }

  if (state.loadingAdmin && !state.settings) {
    return `
      <div class="empty-state">
        <div class="empty-card">
          <span class="loading-inline"><span class="spinner"></span> A carregar configuração...</span>
        </div>
      </div>
    `;
  }

  const settings = state.settings || {
    assistantName: "Logic Chat",
    defaultModel: "gpt-5.3-chat-latest",
    systemPrompt: "",
    reasoningEffort: "medium",
    maxOutputTokens: 2200,
    maskedApiKey: "Nao definida",
    hasApiKey: false,
  };

  return `
    <div class="settings-grid">
      <section>
        <span class="hero-tag">Configuração da conta OpenAI</span>
        <h2 class="section-title">Parâmetros da experiência</h2>
        <p class="section-copy">
          Aqui controlas o modelo usado, a identidade do assistente, o prompt de sistema e a chave que fica guardada apenas no backend.
        </p>

        <form id="settings-form" class="stack">
          <div class="form-grid">
            <div class="field">
              <label for="assistant-name">Nome do assistente</label>
              <input id="assistant-name" class="input" name="assistantName" value="${escapeAttribute(settings.assistantName)}" />
            </div>
            <div class="field">
              <label for="default-model">Modelo</label>
              <input id="default-model" class="input" name="defaultModel" value="${escapeAttribute(settings.defaultModel)}" />
            </div>
            <div class="field">
              <label for="reasoning-effort">Esforço de raciocínio</label>
              <select id="reasoning-effort" class="select" name="reasoningEffort">
                ${["minimal", "low", "medium", "high", "xhigh"].map((value) => `
                  <option value="${value}" ${settings.reasoningEffort === value ? "selected" : ""}>${value}</option>
                `).join("")}
              </select>
            </div>
            <div class="field">
              <label for="max-output-tokens">Max output tokens</label>
              <input id="max-output-tokens" class="input" name="maxOutputTokens" type="number" min="256" max="12000" value="${escapeAttribute(String(settings.maxOutputTokens || 2200))}" />
            </div>
            <div class="field wide">
              <label for="system-prompt">Prompt de sistema</label>
              <textarea id="system-prompt" class="textarea" name="systemPrompt">${escapeHtml(settings.systemPrompt || "")}</textarea>
            </div>
            <div class="field wide">
              <label for="api-key">API key OpenAI</label>
              <input id="api-key" class="input" name="openAiApiKey" type="password" placeholder="Deixa vazio para manter a chave atual" />
              <div class="helper-text">
                Estado atual: <strong>${settings.hasApiKey ? escapeHtml(settings.maskedApiKey) : "Não definida"}</strong>
              </div>
            </div>
          </div>

          <div class="sidebar-actions">
            <button class="button button-primary" type="submit" ${state.savingSettings ? "disabled" : ""}>
              ${state.savingSettings ? `<span class="spinner"></span> A guardar...` : "Guardar configurações"}
            </button>
          </div>
        </form>
      </section>

      <section>
        <span class="hero-tag">Gestão de utilizadores</span>
        <h2 class="section-title">Acessos à aplicação</h2>
        <p class="section-copy">
          O utilizador <strong>ramoscv</strong> mantém acesso exclusivo às configurações. Os restantes utilizadores entram apenas na área de chat.
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

  const logoutButton = document.querySelector("#logout-button");
  if (logoutButton) {
    logoutButton.addEventListener("click", handleLogout);
  }

  const chatTabButton = document.querySelector("#chat-tab-button");
  if (chatTabButton) {
    chatTabButton.addEventListener("click", () => {
      state.view = "chat";
      render();
    });
  }

  const openSettingsButton = document.querySelector("#open-settings-button");
  if (openSettingsButton) {
    openSettingsButton.addEventListener("click", async () => {
      state.view = "settings";
      render();
      await ensureAdminData();
    });
  }

  const settingsTabButton = document.querySelector("#settings-tab-button");
  if (settingsTabButton) {
    settingsTabButton.addEventListener("click", async () => {
      state.view = "settings";
      render();
      await ensureAdminData();
    });
  }

  document.querySelectorAll("[data-chat-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await loadMessages(button.dataset.chatId);
    });
  });

  const composerTextarea = document.querySelector("#composer-textarea");
  if (composerTextarea) {
    composerTextarea.addEventListener("input", (event) => {
      state.composerText = event.target.value;
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
    await loadChats();
    pushToast("Sessão iniciada", "Bem-vindo à plataforma.", "info");
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
    settings: null,
    users: [],
    loginError: "",
  });
  render();
}

async function handleNewChat() {
  try {
    const response = await api("/api/chats", { method: "POST", body: { title: "Nova conversa" } });
    state.chats = [response.chat, ...state.chats];
    state.activeChatId = response.chat.id;
    state.messages = [];
    state.view = "chat";
    render();
  } catch (error) {
    pushToast("Não foi possível criar a conversa.", error.message, "error");
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
      const response = await api("/api/chats", { method: "POST", body: { title: "Nova conversa" } });
      state.chats = [response.chat, ...state.chats];
      state.activeChatId = response.chat.id;
      chatId = response.chat.id;
    } catch (error) {
      pushToast("Não foi possível preparar a conversa.", error.message, "error");
      return;
    }
  }

  const text = state.composerText.trim();
  const attachments = [...state.composerAttachments];
  if (!text && attachments.length === 0) {
    pushToast("Mensagem vazia", "Escreve uma mensagem ou junta pelo menos um anexo.", "error");
    return;
  }

  state.pendingMessage = true;
  state.composerText = "";
  state.composerAttachments = [];

  const optimisticUserMessage = {
    id: `temp-user-${Date.now()}`,
    role: "user",
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
    text: "A gerar resposta...",
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
    pushToast("Não foi possível enviar a mensagem.", error.message, "error");
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
    pushToast("Limite de anexos", "Podes manter no máximo 4 anexos por mensagem.", "error");
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
    pushToast("Conversa apagada", "A conversa foi removida da aplicação.", "info");
  } catch (error) {
    pushToast("Não foi possível apagar a conversa.", error.message, "error");
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
        systemPrompt: form.get("systemPrompt"),
        openAiApiKey: form.get("openAiApiKey"),
        reasoningEffort: form.get("reasoningEffort"),
        maxOutputTokens: Number(form.get("maxOutputTokens")),
      },
    });
    state.settings = response.settings;
    pushToast("Configurações guardadas", "A parametrização da OpenAI foi atualizada.", "info");
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
    pushToast("Utilizador criado", `${response.user.displayName} já pode iniciar sessão.`, "info");
  } catch (error) {
    pushToast("Não foi possível criar o utilizador.", error.message, "error");
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
    pushToast("Não foi possível atualizar o utilizador.", error.message, "error");
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
    pushToast("Não foi possível apagar o utilizador.", error.message, "error");
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
    pushToast("Não foi possível repor a password.", error.message, "error");
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
  state.chats = [...state.chats].sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
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
