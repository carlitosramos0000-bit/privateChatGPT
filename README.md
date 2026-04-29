# Private ChatGPT Pro

Aplicação web estilo ChatGPT com:

- autenticação por utilizador e palavra-passe
- conversas privadas por utilizador
- suporte a anexos
- integração com a API da OpenAI no backend
- administração de utilizadores e parametrização da conta
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

## Administração

Só o utilizador `ramoscv` tem acesso à área de configurações. Nessa área é possível:

- atualizar a API key da OpenAI
- trocar os modelos de assistente, codigo e imagem
- ajustar prompts por modo
- ajustar qualidade e tamanho da imagem
- gerir utilizadores da aplicação

## Notas

- A chave OpenAI é guardada apenas no backend e não é exposta ao frontend.
- Os dados da aplicação ficam em `data/app-data.json`.
- Os segredos locais ficam em `data/server-secret.json`.
- Os anexos enviados ficam em `data/uploads/`.
- Os scripts de arranque já configuram o Node para usar os certificados do Windows e conseguir ligar à API da OpenAI.
- O modo de imagem vem configurado por omissao para `dall-e-3`, como fallback de compatibilidade para geracao de imagem.
- Assim que a organizacao OpenAI estiver verificada, o mais robusto e voltar para um modelo GPT Image suportado.
- Para edicao direta de imagens no modo Imagem, podes usar `dall-e-2` ou um modelo GPT Image depois de verificares a organizacao OpenAI.
