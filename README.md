# Logic Chat

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


## Administração

Só o utilizador adm tem acesso à área de configurações. Nessa área é possível:

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
- O modo de imagem vem preparado para `gpt-image-2`. Se a tua organizacao OpenAI ainda nao estiver verificada, a API pode pedir essa verificacao antes de permitir geracao de imagem com esse modelo.
