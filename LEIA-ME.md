# MyStereo — Rádio Pessoal com Spotify

Uma rádio que toca só as suas músicas do Spotify, com cara de FM: locutor entre as músicas, vinhetas com o nome da rádio e fundo musical por baixo da voz.

Roda inteira no navegador. Não tem servidor próprio nem banco de dados: só arquivos HTML, CSS e JavaScript.

## O que você precisa

- **Spotify Premium** (exigência do Spotify para tocar pelo navegador).
- **Chrome ou Edge no PC** (o player do Spotify não funciona em navegador de celular). No Edge as vozes do locutor são melhores.
- **Python** instalado (só para servir os arquivos localmente).

## Configurar o app no Spotify (uma vez só)

1. Entre em <https://developer.spotify.com/dashboard> e clique em **Create app**.
2. Em **Redirect URIs**, cadastre exatamente `http://127.0.0.1:5500/` (com a barra no final; `localhost` não é aceito).
3. Em **APIs used**, marque **Web API** e **Web Playback SDK**.
4. Salve, abra **Settings** e copie o **Client ID**.
5. Em **User Management**, adicione o nome e o e-mail da sua conta do Spotify. Sem isso a API responde 403.

## Usar

1. Dê dois cliques em `iniciar.bat`. Ele abre `http://127.0.0.1:5500/` no navegador.
2. Cole o Client ID e clique em **Entrar com Spotify**.
3. Clique em **Ligar a rádio**.

Em **Configurações** você escolhe a fonte das músicas (curtidas ou uma playlist sua), de quantas em quantas músicas entram a vinheta e o locutor, a personalidade do locutor, a voz e os programas por horário.

### Locutor com IA (opcional)

- **Roteiro:** informe uma chave da API do Claude para o locutor escrever falas novas a cada música. Sem chave, ele usa frases prontas.
- **Voz:** o padrão é a voz do navegador (grátis). Com uma chave da OpenAI você pode usar o OpenAI TTS.

As chaves ficam guardadas só no `localStorage` do seu navegador e são enviadas direto para a Anthropic e a OpenAI. Não use esta página em um computador compartilhado com as chaves salvas.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `index.html` | A tela |
| `style.css` | A aparência |
| `js/config.js` | Lê e grava as configurações (`localStorage`) |
| `js/banco.js` | Guarda vinhetas em MP3 e o cache de áudios (IndexedDB) |
| `js/spotify.js` | Login (OAuth com PKCE), busca das músicas e o player |
| `js/audio.js` | Fundo musical, vinheta sintetizada e reprodução de MP3 (Web Audio API) |
| `js/locutor.js` | Escreve a fala (Claude ou frases prontas) e transforma em voz |
| `js/app.js` | O ciclo da rádio (vinheta, locutor, música) e os botões |

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| `INVALID_CLIENT: Invalid redirect URI` | O Redirect URI no dashboard não é exatamente `http://127.0.0.1:5500/` |
| Erro 403 em qualquer chamada | Seu e-mail não está em **User Management**, ou a conta não é Premium |
| "Conta: ..." na tela | O Web Playback SDK exige Premium |
| A playlist não aparece na lista | Só aparecem playlists das quais você é dono ou colaborador |
| Locutor mudo | Nenhuma voz em português instalada; teste no Edge ou use o OpenAI TTS |
| Mudei um arquivo e nada mudou | Cache do navegador: recarregue com Ctrl+F5 |

Se algo falhar, abra o console do navegador (F12) e veja as mensagens: todos os erros são registrados lá.
