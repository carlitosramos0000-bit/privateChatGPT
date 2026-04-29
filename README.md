# Logic Chat

Aplicação web estilo ChatGPT com:

- autenticação por utilizador e palavra-passe
- conversas privadas por utilizador
- suporte a anexos
- integração com a API da OpenAI no backend
- administração de utilizadores e parametrização da conta

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
- trocar o modelo e o prompt de sistema
- gerir utilizadores da aplicação

## Notas

- A chave OpenAI é guardada apenas no backend e não é exposta ao frontend.
- Os dados da aplicação ficam em `data/app-data.json`.
- Os segredos locais ficam em `data/server-secret.json`.
- Os anexos enviados ficam em `data/uploads/`.
- Os scripts de arranque já configuram o Node para usar os certificados do Windows e conseguir ligar à API da OpenAI.
