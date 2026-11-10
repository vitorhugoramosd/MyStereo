// spotify.js — tudo que conversa com o Spotify: login, busca de músicas e o player.
//
// O nome é SpotifyApi (e não Spotify) porque o SDK oficial já cria um objeto
// global chamado "Spotify".

const SpotifyApi = (() => {
  // O Spotify não aceita mais "localhost": precisa ser exatamente este endereço.
  const REDIRECT_URI = 'http://127.0.0.1:5500/';
  const ESCOPOS = [
    'streaming',                    // tocar pelo Web Playback SDK
    'user-read-email', 'user-read-private',
    'user-library-read',            // músicas curtidas
    'user-read-playback-state', 'user-modify-playback-state',
    'playlist-read-private', 'playlist-read-collaborative',
  ].join(' ');
  const CHAVE_TOKEN = 'radio-pessoal:token';
  const CHAVE_VERIFICADOR = 'radio-pessoal:pkce';
  const MAX_FAIXAS = 1500;          // limite para não passar minutos carregando bibliotecas enormes

  let player = null;
  let deviceId = null;

  // ---------- Login (OAuth com PKCE) ----------
  // PKCE permite fazer login sem "client secret": o navegador cria um segredo
  // temporário (verificador), manda só o hash dele na ida e prova que é o mesmo
  // navegador na volta, enviando o segredo original.

  function textoAleatorio(tamanho) {
    const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(tamanho));
    return Array.from(bytes, b => letras[b % letras.length]).join('');
  }

  async function sha256Base64Url(texto) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function iniciarLogin() {
    const clientId = Config.valores.clientId.trim();
    if (!clientId) throw new Error('Informe o Client ID do Spotify.');
    const verificador = textoAleatorio(64);
    sessionStorage.setItem(CHAVE_VERIFICADOR, verificador);
    const parametros = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: await sha256Base64Url(verificador),
      scope: ESCOPOS,
    });
    location.href = 'https://accounts.spotify.com/authorize?' + parametros;
  }

  async function pedirToken(campos) {
    const resposta = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: Config.valores.clientId.trim(), ...campos }),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error('Login no Spotify falhou: ' + (dados.error_description || dados.error || resposta.status));
    const anterior = lerToken();
    localStorage.setItem(CHAVE_TOKEN, JSON.stringify({
      acesso: dados.access_token,
      // Na renovação o Spotify nem sempre devolve um refresh novo; mantém o antigo.
      renovacao: dados.refresh_token || (anterior && anterior.renovacao),
      expiraEm: Date.now() + (dados.expires_in - 60) * 1000,
    }));
  }

  // Chamado ao abrir a página: se o Spotify nos devolveu "?code=...", troca pelo token.
  async function concluirLoginSeVoltou() {
    const parametros = new URLSearchParams(location.search);
    const codigo = parametros.get('code');
    const erro = parametros.get('error');
    if (!codigo && !erro) return;
    history.replaceState(null, '', location.pathname);   // limpa a URL
    if (erro) throw new Error('O Spotify recusou o login: ' + erro);
    const verificador = sessionStorage.getItem(CHAVE_VERIFICADOR);
    if (!verificador) throw new Error('Login incompleto. Clique em "Entrar com Spotify" de novo.');
    await pedirToken({ grant_type: 'authorization_code', code: codigo, redirect_uri: REDIRECT_URI, code_verifier: verificador });
    sessionStorage.removeItem(CHAVE_VERIFICADOR);
  }

  function lerToken() {
    try { return JSON.parse(localStorage.getItem(CHAVE_TOKEN)); } catch { return null; }
  }

  function estaLogado() { return !!lerToken(); }

  function sair() {
    localStorage.removeItem(CHAVE_TOKEN);
    if (player) player.disconnect();
  }

  // Devolve um token válido, renovando sozinho quando está vencido (dura 1 hora).
  let renovando = null;
  async function obterToken() {
    const t = lerToken();
    if (!t) throw new Error('Não conectado ao Spotify.');
    if (Date.now() < t.expiraEm) return t.acesso;
    if (!renovando) {
      renovando = pedirToken({ grant_type: 'refresh_token', refresh_token: t.renovacao })
        .finally(() => { renovando = null; });
    }
    await renovando;
    return lerToken().acesso;
  }

  // ---------- Web API ----------

  const dormir = ms => new Promise(r => setTimeout(r, ms));

  async function api(metodo, caminho, corpo, tentativa = 0) {
    const url = caminho.startsWith('http') ? caminho : 'https://api.spotify.com/v1' + caminho;
    const resposta = await fetch(url, {
      method: metodo,
      headers: { Authorization: 'Bearer ' + await obterToken(), 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });

    // 429 = pedidos demais; o Spotify diz quantos segundos esperar.
    if (resposta.status === 429 && tentativa < 3) {
      await dormir((Number(resposta.headers.get('Retry-After')) || 2) * 1000);
      return api(metodo, caminho, corpo, tentativa + 1);
    }
    if (!resposta.ok) {
      const dados = await resposta.json().catch(() => ({}));
      let mensagem = `Spotify ${resposta.status} em ${metodo} ${caminho.split('?')[0]}: ${(dados.error && dados.error.message) || resposta.statusText}`;
      if (resposta.status === 403) mensagem += ' — confira se a conta é Premium e se o seu e-mail está em User Management no dashboard do app.';
      const erro = new Error(mensagem);
      erro.status = resposta.status;
      throw erro;
    }
    const texto = await resposta.text();     // vários PUT devolvem corpo vazio
    try { return texto ? JSON.parse(texto) : null; } catch { return null; }
  }

  const meuPerfil = () => api('GET', '/me');

  // Só as playlists que o usuário é dono ou colabora (as outras não devolvem faixas).
  async function minhasPlaylists(meuId) {
    const lista = [];
    let url = '/me/playlists?limit=50';
    while (url) {
      const pagina = await api('GET', url);
      for (const p of pagina.items || []) {
        if (p && ((p.owner && p.owner.id === meuId) || p.collaborative)) lista.push({ id: p.id, nome: p.name });
      }
      url = pagina.next;
    }
    return lista;
  }

  // Converte o item do Spotify num objeto simples, só com o que a rádio usa.
  function simplificar(item) {
    // Desde fev/2026 a faixa vem em "item"; antes vinha em "track". Aceita os dois.
    const f = item && (item.item || item.track);
    if (!f || !f.uri || f.is_local || f.type !== 'track') return null;
    const imagens = (f.album && f.album.images) || [];
    return {
      uri: f.uri,
      nome: f.name,
      artistas: (f.artists || []).map(a => a.name).join(', '),
      album: f.album ? f.album.name : '',
      ano: f.album && f.album.release_date ? f.album.release_date.slice(0, 4) : '',
      capa: imagens.length ? imagens[0].url : '',
      duracaoMs: f.duration_ms,
    };
  }

  // fonte = 'curtidas' ou o id de uma playlist.
  async function carregarFaixas(fonte) {
    const faixas = [];
    let url = fonte === 'curtidas'
      ? '/me/tracks?limit=50'
      : `/playlists/${encodeURIComponent(fonte)}/items?limit=50`;
    while (url && faixas.length < MAX_FAIXAS) {
      const pagina = await api('GET', url);
      for (const item of pagina.items || []) {
        const faixa = simplificar(item);
        if (faixa) faixas.push(faixa);
      }
      url = pagina.next;
    }
    return faixas;
  }

  // ---------- Player (Web Playback SDK) ----------
  // O SDK transforma esta aba num "aparelho" do Spotify, como se fosse uma caixa de som.

  function carregarSdk() {
    return new Promise((resolver, rejeitar) => {
      if (window.Spotify) return resolver();
      window.onSpotifyWebPlaybackSDKReady = resolver;   // o SDK chama esta função quando termina de carregar
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.onerror = () => rejeitar(new Error('Não consegui baixar o SDK do Spotify.'));
      document.head.appendChild(script);
    });
  }

  // aoErro(mensagem) é chamado quando o SDK reporta um problema.
  async function criarPlayer(nome, aoErro) {
    await carregarSdk();
    player = new Spotify.Player({
      name: nome,
      getOAuthToken: entregar => obterToken().then(entregar).catch(e => aoErro(e.message)),
      volume: Config.valores.volume,
    });
    player.addListener('initialization_error', e => aoErro('Player: ' + e.message));
    player.addListener('authentication_error', e => aoErro('Autenticação: ' + e.message + ' — saia e entre de novo.'));
    player.addListener('account_error', e => aoErro('Conta: ' + e.message + ' — o Web Playback SDK exige Spotify Premium.'));
    player.addListener('playback_error', e => aoErro('Reprodução: ' + e.message));
    player.addListener('not_ready', () => { deviceId = null; });

    const pronto = new Promise((resolver, rejeitar) => {
      player.addListener('ready', e => { deviceId = e.device_id; resolver(); });
      setTimeout(() => rejeitar(new Error('O player do Spotify não respondeu em 20 s.')), 20000);
    });
    if (!await player.connect()) throw new Error('Não consegui conectar o player do Spotify.');
    await pronto;
    return player;
  }

  // Manda tocar UMA faixa só. Assim o Spotify não avança sozinho para a próxima
  // e a rádio controla o que vem depois (vinheta, locutor, etc.).
  async function tocar(uri) {
    for (let tentativa = 0; ; tentativa++) {
      try {
        if (!deviceId) throw Object.assign(new Error('Player do Spotify desconectado.'), { status: 404 });
        return await api('PUT', '/me/player/play?device_id=' + deviceId, { uris: [uri] });
      } catch (e) {
        // Logo depois de conectar, o aparelho pode levar um instante para "existir" (404) ou o servidor oscilar (5xx).
        const vale = e.status === 404 || e.status >= 500;
        if (!vale || tentativa >= 3) throw e;
        await dormir(1200);
      }
    }
  }

  return {
    REDIRECT_URI, iniciarLogin, concluirLoginSeVoltou, estaLogado, sair,
    meuPerfil, minhasPlaylists, carregarFaixas, criarPlayer, tocar,
  };
})();
