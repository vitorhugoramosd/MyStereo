// app.js — o "maestro": liga a tela aos outros arquivos e roda o ciclo da rádio.
//
// Ciclo, repetido enquanto a rádio está ligada:
//   1. vinheta (a cada N músicas)   2. fala do locutor (a cada N músicas)   3. música

(() => {
  const cfg = Config.valores;
  const $ = id => document.getElementById(id);   // atalho para pegar um elemento da tela

  const FADE_FIM_MS = 3000;    // quanto antes do fim da música o volume começa a baixar
  const CHAVE_HISTORICO = 'radio-pessoal:historico';

  // ---------- Estado ----------
  let player = null;
  let perfil = null;
  let ligada = false;
  let etapaAtual = null;       // AbortController da etapa em andamento (ver "etapa" abaixo)
  let fila = [];               // próximas músicas, já embaralhadas
  let todasFaixas = [];
  let fonteCarregada = null;   // de onde veio "todasFaixas" (para saber quando recarregar)
  let tocadas = 0;             // quantas músicas já foram ao ar desde que ligou
  let faixaAnterior = null;
  let falaPronta = null;       // { uri, promessa } — fala preparada com antecedência

  // ---------- Utilidades ----------

  function status(mensagem, erro = false) {
    $('status').textContent = mensagem;
    $('status').classList.toggle('erro', erro);
    if (erro) console.error(mensagem); else if (mensagem) console.log(mensagem);
  }

  function formatarTempo(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // Embaralhamento de Fisher-Yates: percorre de trás para frente trocando cada item com um anterior sorteado.
  function embaralhar(lista) {
    const copia = lista.slice();
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
  }

  // Devolve o resultado da promessa, ou null se ela demorar mais que "ms".
  function comLimite(promessa, ms) {
    return Promise.race([promessa, new Promise(r => setTimeout(() => r(null), ms))]);
  }

  // ---------- Tela ----------

  function mostrarEtapa(tipo, texto) {
    $('etapa').textContent = texto;
    $('etapa').className = 'etiqueta ' + tipo;
  }

  function mostrarFaixa(faixa) {
    $('faixaNome').textContent = faixa.nome;
    $('faixaArtista').textContent = faixa.artistas + (faixa.album ? ' — ' + faixa.album : '');
    if (faixa.capa) $('capa').src = faixa.capa;
    $('tempoTotal').textContent = formatarTempo(faixa.duracaoMs);
    mostrarProgresso(0, faixa.duracaoMs);
  }

  function mostrarProgresso(posicao, duracao) {
    $('barraProgresso').style.width = (duracao ? Math.min(100, posicao / duracao * 100) : 0) + '%';
    $('tempoAtual').textContent = formatarTempo(posicao);
  }

  function preencherLista(elemento, itens, montar) {
    elemento.replaceChildren(...itens.map(item => {
      const li = document.createElement('li');
      montar(li, item);
      return li;
    }));
  }

  function mostrarProximas() {
    preencherLista($('listaProximas'), fila.slice(0, 6), (li, f) => { li.textContent = `${f.nome} — ${f.artistas}`; });
  }

  // Histórico do dia: guardado no localStorage junto com a data; vira o dia, zera.
  function lerHistorico() {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_HISTORICO));
      if (salvo && salvo.dia === new Date().toDateString()) return salvo.itens;
    } catch { /* ignora histórico corrompido */ }
    return [];
  }

  function mostrarHistorico(itens = lerHistorico()) {
    preencherLista($('listaHistorico'), itens.slice().reverse(), (li, h) => {
      const hora = document.createElement('span');
      hora.className = 'hora';
      hora.textContent = h.hora;
      li.append(hora, `${h.nome} — ${h.artistas}`);
    });
  }

  function registrarNoHistorico(faixa) {
    const itens = lerHistorico();
    itens.push({
      hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      nome: faixa.nome, artistas: faixa.artistas,
    });
    localStorage.setItem(CHAVE_HISTORICO, JSON.stringify({ dia: new Date().toDateString(), itens }));
    mostrarHistorico(itens);
  }

  function atualizarBotoes() {
    $('btnLigar').disabled = ligada || !player;
    $('btnPular').disabled = !ligada;
    $('btnDesligar').disabled = !ligada;
    $('luzNoAr').classList.toggle('ligada', ligada);
    const programa = Config.programaAtual();
    $('subtitulo').textContent = ligada ? (programa ? programa.nome : 'No ar') : 'Desligada';
    $('tituloRadio').textContent = cfg.nomeRadio;
    document.title = cfg.nomeRadio;
  }

  // ---------- Fila de músicas ----------

  const fonteAtual = () => { const p = Config.programaAtual(); return p ? p.fonte : cfg.fonte; };

  // Carrega as músicas da fonte atual se ainda não carregou (ou se o programa mudou).
  async function garantirFaixas() {
    const fonte = fonteAtual();
    if (fonte === fonteCarregada && todasFaixas.length) return;
    status('Carregando músicas do Spotify...');
    const faixas = await SpotifyApi.carregarFaixas(fonte);
    if (!faixas.length) throw new Error('Nenhuma música encontrada nessa fonte. Escolha outra nas Configurações.');
    todasFaixas = faixas;
    fonteCarregada = fonte;
    fila = embaralhar(faixas);
    falaPronta = null;   // a fala preparada era para uma música da fila antiga
    status(`${faixas.length} músicas carregadas.`);
  }

  function proximaDaFila() {
    if (!fila.length) fila = embaralhar(todasFaixas);   // acabou: embaralha tudo de novo
    return fila.shift();
  }

  // ---------- Etapas ----------
  // Cada etapa (vinheta, fala, música) recebe um "sinal" de cancelamento.
  // Pular = cancelar a etapa em andamento; a função da etapa percebe e encerra.

  async function etapa(tipo, texto, acao) {
    if (!ligada) return;
    etapaAtual = new AbortController();
    mostrarEtapa(tipo, texto);
    try { await acao(etapaAtual.signal); }
    finally { etapaAtual = null; }
  }

  const temVinheta = n => cfg.vinhetaACada > 0 && n % cfg.vinhetaACada === 0;
  const temFala = n => cfg.falaACada > 0 && n % cfg.falaACada === 0;

  // Começa a preparar a fala que vai anunciar "proxima" — sem esperar terminar.
  function prepararFala(anterior, proxima) {
    const programa = Config.programaAtual();
    falaPronta = {
      uri: proxima.uri,
      promessa: Locutor.preparar({ anterior, proxima, programa: programa && programa.nome }),
    };
  }

  // Baixa o volume do Spotify aos poucos até zero.
  async function fadeOut(duracaoMs) {
    const passos = 12;
    const inicial = await player.getVolume().catch(() => cfg.volume);
    for (let i = passos - 1; i >= 0; i--) {
      await player.setVolume(inicial * i / passos).catch(() => {});
      await Som.esperar(duracaoMs / passos);
    }
  }

  async function tocarMusica(faixa, sinal) {
    await player.setVolume(cfg.volume);
    await SpotifyApi.tocar(faixa.uri);

    const inicio = Date.now();
    let comecou = false;
    let pertoDoFim = false;

    // Consulta o player duas vezes por segundo até a música acabar ou alguém pular.
    while (!sinal.aborted) {
      await Som.esperar(500, sinal);
      if (sinal.aborted) break;
      const estado = await player.getCurrentState();

      if (!estado || (!comecou && estado.position === 0)) {
        if (Date.now() - inicio > 20000) { status('A música não começou em 20 s; indo para a próxima.', true); break; }
        continue;
      }
      if (!comecou && !estado.paused) { comecou = true; status(''); }

      mostrarProgresso(estado.position, estado.duration);

      // Faltando pouco: sai do laço para fazer o fade out antes do locutor entrar.
      if (estado.duration - estado.position <= FADE_FIM_MS) { pertoDoFim = true; break; }
      // Parou sozinha na posição zero depois de ter começado = a faixa terminou.
      if (comecou && estado.paused && estado.position === 0) break;
    }

    // Fim natural: fade mais longo. Pulou ou desligou: fade rápido.
    await fadeOut(pertoDoFim ? FADE_FIM_MS - 500 : 500);
    await player.pause().catch(() => {});
  }

  // ---------- Ciclo principal ----------

  async function rodar() {
    let errosSeguidos = 0;
    while (ligada) {
      try {
        await garantirFaixas();
        const faixa = proximaDaFila();
        mostrarProximas();
        const n = tocadas;

        // A fala começa a ser preparada antes da vinheta, para ganhar tempo.
        if (temFala(n) && (!falaPronta || falaPronta.uri !== faixa.uri)) prepararFala(faixaAnterior, faixa);

        if (temVinheta(n)) {
          await etapa('vinheta', 'Vinheta', sinal =>
            Som.tocarVinheta(sinal, s => Locutor.falarNomeDaRadio(s)));
        }

        if (temFala(n) && ligada) {
          await etapa('fala', 'Locutor', async sinal => {
            // Se a fala ainda não ficou pronta em 6 s, entra uma frase pronta para não ficar em silêncio.
            const preparada = await comLimite(falaPronta.promessa, 6000)
              || { texto: Locutor.fraseReserva({ anterior: faixaAnterior, proxima: faixa }), audio: null, idioma: 'pt' };
            $('ultimaFala').textContent = preparada.texto;
            await Locutor.falar(preparada, sinal);
          });
        }
        falaPronta = null;
        if (!ligada) break;

        await etapa('musica', 'Música', async sinal => {
          mostrarFaixa(faixa);
          registrarNoHistorico(faixa);
          atualizarBotoes();   // atualiza o nome do programa no topo
          // Enquanto esta música toca, já prepara a fala da próxima.
          const seguinte = fila[0];
          if (seguinte && temFala(n + 1) && fonteAtual() === fonteCarregada) prepararFala(faixa, seguinte);
          await tocarMusica(faixa, sinal);
        });

        faixaAnterior = faixa;
        tocadas++;
        errosSeguidos = 0;
      } catch (e) {
        errosSeguidos++;
        status(e.message, true);
        if (errosSeguidos >= 3) { status('Três erros seguidos; desliguei a rádio. Último: ' + e.message, true); break; }
        await Som.esperar(2500);
      }
    }
    ligada = false;
    if (player) await player.pause().catch(() => {});
    mostrarEtapa('', 'Parada');
    atualizarBotoes();
  }

  function ligar() {
    // Estas duas chamadas PRECISAM acontecer dentro do clique: o navegador
    // bloqueia áudio que não começou por uma ação do usuário.
    player.activateElement();
    Som.iniciar();

    ligada = true;
    tocadas = 0;
    faixaAnterior = null;
    falaPronta = null;
    atualizarBotoes();
    rodar();
  }

  const pular = () => { if (etapaAtual) etapaAtual.abort(); };

  function desligar() {
    ligada = false;
    pular();
    status('Rádio desligada.');
  }

  // ---------- Configurações ----------

  // Liga cada campo que tem data-cfg="nome" ao valor Config.valores.nome, nos dois sentidos.
  function ligarCampos(raiz) {
    for (const campo of raiz.querySelectorAll('[data-cfg]')) {
      const chave = campo.dataset.cfg;
      if (campo.type === 'checkbox') campo.checked = !!cfg[chave]; else campo.value = cfg[chave];
      campo.addEventListener('change', () => {
        cfg[chave] = campo.type === 'checkbox' ? campo.checked
          : (campo.type === 'number' || campo.type === 'range') ? Number(campo.value)
          : campo.value;
        Config.salvar();
        aoMudarConfig(chave);
      });
    }
  }

  function aoMudarConfig(chave) {
    if (chave === 'volume' && player) player.setVolume(cfg.volume).catch(() => {});
    atualizarBotoes();
  }

  function opcao(valor, texto) {
    const o = document.createElement('option');
    o.value = valor;
    o.textContent = texto;
    return o;
  }

  function preencherFontes(select, playlists, valorAtual) {
    select.replaceChildren(opcao('curtidas', 'Músicas curtidas'), ...playlists.map(p => opcao(p.id, 'Playlist: ' + p.nome)));
    select.value = valorAtual;
    if (select.value !== valorAtual) select.value = 'curtidas';   // a playlist salva não existe mais
  }

  function montarProgramas(playlists) {
    const limites = cfg.programas.map(p => p.inicio).concat(24);
    $('programas').replaceChildren(...cfg.programas.map((programa, i) => {
      const linha = document.createElement('div');
      linha.className = 'programa';

      const horario = document.createElement('div');
      horario.className = 'faixa-hora';
      horario.textContent = `${limites[i]}h às ${limites[i + 1]}h`;

      const nome = document.createElement('input');
      nome.type = 'text';
      nome.value = programa.nome;
      nome.addEventListener('change', () => { programa.nome = nome.value; Config.salvar(); atualizarBotoes(); });

      const fonte = document.createElement('select');
      preencherFontes(fonte, playlists, programa.fonte);
      fonte.addEventListener('change', () => { programa.fonte = fonte.value; Config.salvar(); });

      const rotuloNome = document.createElement('label');
      rotuloNome.append('Nome do programa', nome);
      const rotuloFonte = document.createElement('label');
      rotuloFonte.append('Fonte', fonte);
      linha.append(horario, rotuloNome, rotuloFonte);
      return linha;
    }));
  }

  function montarVozes() {
    const preencher = (id, idioma, chave) => {
      const vozes = Locutor.listarVozes(idioma);
      $(id).replaceChildren(opcao('', 'Automática (melhor disponível)'), ...vozes.map(v => opcao(v.name, `${v.name} (${v.lang})`)));
      $(id).value = cfg[chave];
    };
    preencher('selVozNavegador', 'pt', 'vozNavegador');
    preencher('selVozIngles', 'en', 'vozIngles');
  }

  async function mostrarVinhetas() {
    const vinhetas = await Banco.listarVinhetas();
    preencherLista($('listaVinhetas'), vinhetas, (li, v) => {
      const remover = document.createElement('button');
      remover.className = 'mini';
      remover.textContent = 'Remover';
      remover.addEventListener('click', async () => { await Banco.removerVinheta(v.id); mostrarVinhetas(); });
      li.append(v.nome, remover);
    });
  }

  // Roda um teste de som (fala ou vinheta) fora do ciclo da rádio.
  async function testar(acao) {
    if (ligada) return status('Desligue a rádio para testar.');
    Som.iniciar();
    try { await acao(new AbortController().signal); }
    catch (e) { status('Teste falhou: ' + e.message, true); }
  }

  // ---------- Início ----------

  async function iniciar() {
    ligarCampos(document);
    montarProgramas([]);
    preencherFontes(document.querySelector('.selFonte'), [], cfg.fonte);
    montarVozes();
    speechSynthesis.addEventListener('voiceschanged', montarVozes);   // as vozes chegam com atraso
    mostrarHistorico();
    mostrarVinhetas().catch(e => console.warn('Vinhetas:', e));
    atualizarBotoes();

    $('btnLogin').addEventListener('click', () => SpotifyApi.iniciarLogin().catch(e => status(e.message, true)));
    $('btnLigar').addEventListener('click', ligar);
    $('btnPular').addEventListener('click', pular);
    $('btnDesligar').addEventListener('click', desligar);
    $('btnSair').addEventListener('click', () => { desligar(); SpotifyApi.sair(); location.reload(); });

    $('btnTestarFala').addEventListener('click', () => testar(async sinal => {
      const exemplo = { nome: 'Evidências', artistas: 'Chitãozinho & Xororó', album: '', ano: '' };
      const preparada = await Locutor.preparar({ anterior: null, proxima: exemplo, programa: null });
      $('ultimaFala').textContent = preparada.texto;
      await Locutor.falar(preparada, sinal);
    }));
    $('btnTestarVinheta').addEventListener('click', () => testar(sinal =>
      Som.tocarVinheta(sinal, s => Locutor.falarNomeDaRadio(s))));

    $('arquivoVinheta').addEventListener('change', async evento => {
      for (const arquivo of evento.target.files) await Banco.adicionarVinheta(arquivo.name, arquivo);
      evento.target.value = '';
      mostrarVinhetas();
    });

    if (location.hostname !== '127.0.0.1') {
      status(`Abra a página por ${SpotifyApi.REDIRECT_URI} (use o iniciar.bat). O login do Spotify só funciona nesse endereço.`, true);
    }

    try {
      await SpotifyApi.concluirLoginSeVoltou();
      if (!SpotifyApi.estaLogado()) return;

      $('cartaoLogin').hidden = true;
      status('Conectando ao Spotify...');
      perfil = await SpotifyApi.meuPerfil();
      $('contaInfo').textContent = `Conectado como ${perfil.display_name || perfil.id}`;
      if (perfil.product && perfil.product !== 'premium') status('Esta conta não é Premium; o Spotify não vai deixar tocar.', true);

      const playlists = await SpotifyApi.minhasPlaylists(perfil.id);
      preencherFontes(document.querySelector('.selFonte'), playlists, cfg.fonte);
      montarProgramas(playlists);

      player = await SpotifyApi.criarPlayer(cfg.nomeRadio, mensagem => status(mensagem, true));
      status('Tudo pronto. Clique em "Ligar a rádio".');
      atualizarBotoes();
    } catch (e) {
      $('cartaoLogin').hidden = false;
      status(e.message, true);
    }
  }

  iniciar();
})();
