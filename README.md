# Private ChatGPT Pro

Aplicacao web estilo ChatGPT com:

- autenticacao por utilizador e palavra-passe
- conversas privadas por utilizador
- suporte a anexos
- integracao com a API da OpenAI no backend
- administracao de utilizadores e parametrizacao da conta
- modos de assistente, codigo e imagem
- selecao manual de modo e modo `Auto`
- geracao de HTML/CSS a partir de imagens
- geracao e edicao de imagens realistas

## Arranque

No PowerShell:

```powershell
.\start.ps1
```

Ou no `cmd`:

```cmd
start.cmd
```

Depois abre [http://localhost:3000](http://localhost:3000).

## Credenciais iniciais

- Utilizador: `ramoscv`
- Palavra-passe: `Logica!1`

## Administracao

So o utilizador `ramoscv` tem acesso a area de configuracoes. Nessa area e possivel:

- atualizar a API key da OpenAI
- trocar os modelos de assistente, codigo e imagem
- ajustar prompts por modo
- ajustar qualidade e tamanho da imagem
- gerir utilizadores da aplicacao

## Notas

- A chave OpenAI e guardada apenas no backend e nao e exposta ao frontend.
- Por omissao, os dados da aplicacao ficam em `data/app-data.json`.
- Por omissao, os segredos locais ficam em `data/server-secret.json`.
- Os anexos enviados ficam em `data/uploads/`.
- Podes definir `APP_DATA_DIR` para guardar utilizadores, chats, uploads e segredos noutro diretorio persistente.
- Os scripts de arranque ja configuram o Node para usar os certificados do Windows e conseguir ligar a API da OpenAI.
- O modo de imagem vem configurado por omissao para `dall-e-3`, como fallback de compatibilidade para geracao de imagem.
- Assim que a organizacao OpenAI estiver verificada, o mais robusto e voltar para um modelo GPT Image suportado.
- Para edicao direta de imagens no modo Imagem, podes usar `dall-e-2` ou um modelo GPT Image depois de verificares a organizacao OpenAI.

## Persistencia no Render

Para nao perder utilizadores nem conversas em cada deploy:

- adiciona um Persistent Disk ao servico
- monta o disk em `/var/data`
- define a env var `APP_DATA_DIR=/var/data/private-chatgpt-pro`

O repositorio inclui um `render.yaml` com esta configuracao base.
