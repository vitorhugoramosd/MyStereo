// audio.js — sons gerados pela própria página com a Web Audio API:
// vinheta, fundo musical do locutor, efeito de transição e reprodução de MP3.
//
// Web Audio funciona como uma mesa de som: você cria "nós" (osciladores,
// volumes, filtros) e liga um no outro até chegar na saída.
//
// A estética é de rádio synthwave dos anos 80: chiado de sintonia, acordes
// de sintetizador com bastante reverberação, arpejos com eco e sinos.
//
// "sinal" (AbortSignal) aparece em várias funções: é o aviso de cancelamento.
// Quando o usuário clica em Pular, o sinal dispara e o som para na hora.
// É o equivalente ao CancellationToken do C#.

// O nome é Som (e não Audio) porque o navegador já tem um objeto global "Audio".
const Som = (() => {
  let ctx = null;        // AudioContext: o "motor" de áudio. Só pode nascer dentro de um clique.
  let saida = null;      // ponto final da mesa: tudo passa por aqui
  let reverb = null;     // efeito de sala grande (reverberação)
  let eco = null;        // efeito de repetição (delay)
  let medidor = null;    // lê o volume que está saindo (usado só para testes)
  let ruido = null;      // 2 segundos de chiado, reaproveitados por vários efeitos

  // Notas usadas (frequência em Hz).
  const N = {
    F2: 87.31, G2: 98.00, A2: 110.00, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00,
    A3: 220.00, B3: 246.94, C4: 261.63, E4: 329.63, G4: 392.00, A4: 440.00, C5: 523.25,
    E5: 659.25, G5: 783.99, A5: 880.00, C6: 1046.50, E6: 1318.51,
  };

  function iniciar() {
    if (!ctx) {
      ctx = new AudioContext();

      // Compressor: segura os picos para nada estourar quando vários sons se somam.
      const compressor = ctx.createDynamicsCompressor();
      medidor = ctx.createAnalyser();
      medidor.fftSize = 2048;
      saida = ctx.createGain();
      saida.connect(compressor).connect(medidor).connect(ctx.destination);

      // Reverberação: o ConvolverNode aplica a "impressão digital" de um ambiente.
      // Aqui a impressão é fabricada: chiado que vai sumindo ao longo de 3,5 s.
      reverb = ctx.createConvolver();
      reverb.buffer = criarImpulso(3.5);
      reverb.connect(saida);

      // Eco: um atraso de 0,33 s que realimenta a si mesmo, cada vez mais fraco e abafado.
      eco = ctx.createDelay(1);
      eco.delayTime.value = 0.33;
      const realimentacao = ctx.createGain();
      realimentacao.gain.value = 0.38;
      const abafar = ctx.createBiquadFilter();
      abafar.type = 'lowpass';
      abafar.frequency.value = 2400;
      eco.connect(abafar).connect(realimentacao).connect(eco);
      eco.connect(saida);
      eco.connect(reverb);

      ruido = criarRuido(2);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function criarRuido(segundos) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * segundos, ctx.sampleRate);
    const dados = buffer.getChannelData(0);
    for (let i = 0; i < dados.length; i++) dados[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function criarImpulso(segundos) {
    const tamanho = ctx.sampleRate * segundos;
    const buffer = ctx.createBuffer(2, tamanho, ctx.sampleRate);
    for (let canal = 0; canal < 2; canal++) {
      const dados = buffer.getChannelData(canal);
      for (let i = 0; i < tamanho; i++) dados[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / tamanho, 3);
    }
    return buffer;
  }

  // Espera "ms" milissegundos, ou menos se o sinal for cancelado.
  function esperar(ms, sinal) {
    return new Promise(resolver => {
      if (sinal && sinal.aborted) return resolver();
      const timer = setTimeout(resolver, ms);
      if (sinal) sinal.addEventListener('abort', () => { clearTimeout(timer); resolver(); }, { once: true });
    });
  }

  // Um "canal" da mesa: volume próprio, com mandadas opcionais para reverb e eco.
  // Tudo que um trecho toca passa pelo canal; para cortar o trecho, basta fechá-lo.
  function criarCanal(volume, quantoReverb = 0, quantoEco = 0) {
    const canal = ctx.createGain();
    canal.gain.value = volume;
    canal.connect(saida);
    for (const [efeito, quanto] of [[reverb, quantoReverb], [eco, quantoEco]]) {
      if (!quanto) continue;
      const mandada = ctx.createGain();
      mandada.gain.value = quanto;
      canal.connect(mandada).connect(efeito);
    }
    return canal;
  }

  function fecharCanal(canal, segundos = 0.3) {
    const agora = ctx.currentTime;
    canal.gain.cancelScheduledValues(agora);
    canal.gain.setValueAtTime(canal.gain.value, agora);
    canal.gain.linearRampToValueAtTime(0, agora + segundos);
    setTimeout(() => canal.disconnect(), segundos * 1000 + 4000);   // espera a cauda do reverb
  }

  // ---------- Instrumentos ----------

  // Nota simples: ataque rápido e som que vai sumindo.
  function nota(canal, frequencia, inicio, duracao, tipo = 'triangle', volume = 0.2) {
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = tipo;
    osc.frequency.value = frequencia;
    ganho.gain.setValueAtTime(0.0001, inicio);
    ganho.gain.linearRampToValueAtTime(volume, inicio + 0.015);
    ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
    osc.connect(ganho).connect(canal);
    osc.start(inicio);
    osc.stop(inicio + duracao + 0.05);
  }

  // Sino brilhante: a nota mais um harmônico "desafinado", que dá o timbre metálico.
  function sino(canal, frequencia, inicio, volume = 0.12) {
    nota(canal, frequencia, inicio, 2.2, 'sine', volume);
    nota(canal, frequencia * 2.76, inicio, 0.9, 'sine', volume * 0.35);
  }

  // Acorde de sintetizador (pad): para cada nota, três ondas levemente desafinadas
  // entre si (deixa o som "largo"), passando por um filtro que abre e fecha devagar.
  function pad(canal, frequencias, inicio, duracao, volume = 0.03) {
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.Q.value = 0.7;
    filtro.frequency.setValueAtTime(350, inicio);
    filtro.frequency.linearRampToValueAtTime(1900, inicio + duracao * 0.45);
    filtro.frequency.linearRampToValueAtTime(500, inicio + duracao);

    const ganho = ctx.createGain();
    ganho.gain.setValueAtTime(0.0001, inicio);
    ganho.gain.linearRampToValueAtTime(volume, inicio + Math.min(0.9, duracao * 0.3));
    ganho.gain.setValueAtTime(volume, inicio + duracao * 0.7);
    ganho.gain.linearRampToValueAtTime(0.0001, inicio + duracao);
    filtro.connect(ganho).connect(canal);

    for (const frequencia of frequencias) {
      for (const desafino of [-9, 0, 9]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = frequencia;
        osc.detune.value = desafino;
        osc.connect(filtro);
        osc.start(inicio);
        osc.stop(inicio + duracao + 0.1);
      }
    }
  }

  // Fonte de chiado tocando em laço, começando em "inicio" e parando em "fim".
  function chiado(inicio, fim) {
    const fonte = ctx.createBufferSource();
    fonte.buffer = ruido;
    fonte.loop = true;
    fonte.start(inicio, Math.random() * 1.5);
    fonte.stop(fim);
    return fonte;
  }

  // Rádio sendo sintonizado: chiado passando por um filtro que "varre" as
  // frequências, mais uns assobios curtos, como estações passando pelo dial.
  function sintonia(canal, inicio, duracao, volume = 0.22) {
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.Q.value = 3.5;
    filtro.frequency.setValueAtTime(500, inicio);
    filtro.frequency.exponentialRampToValueAtTime(3800, inicio + duracao * 0.55);
    filtro.frequency.exponentialRampToValueAtTime(1300, inicio + duracao);

    const ganho = ctx.createGain();
    ganho.gain.setValueAtTime(0.0001, inicio);
    ganho.gain.linearRampToValueAtTime(volume, inicio + 0.08);
    ganho.gain.setValueAtTime(volume, inicio + duracao * 0.75);
    ganho.gain.linearRampToValueAtTime(0.0001, inicio + duracao);
    chiado(inicio, inicio + duracao + 0.05).connect(filtro).connect(ganho).connect(canal);

    for (let i = 0; i < 3; i++) {
      const quando = inicio + duracao * (0.15 + i * 0.25);
      const frequencia = 700 + Math.random() * 1600;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(frequencia, quando);
      osc.frequency.exponentialRampToValueAtTime(frequencia * (Math.random() < 0.5 ? 0.45 : 1.9), quando + 0.16);
      g.gain.setValueAtTime(0.0001, quando);
      g.gain.linearRampToValueAtTime(volume * 0.22, quando + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, quando + 0.17);
      osc.connect(g).connect(canal);
      osc.start(quando);
      osc.stop(quando + 0.2);
    }
  }

  // Subida de chiado que cresce e corta de repente (o "vvvuuush" antes de algo entrar).
  function subida(canal, inicio, duracao, volume = 0.16) {
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.Q.value = 1.2;
    filtro.frequency.setValueAtTime(300, inicio);
    filtro.frequency.exponentialRampToValueAtTime(7000, inicio + duracao);
    const ganho = ctx.createGain();
    ganho.gain.setValueAtTime(0.0001, inicio);
    ganho.gain.exponentialRampToValueAtTime(volume, inicio + duracao);
    ganho.gain.linearRampToValueAtTime(0.0001, inicio + duracao + 0.04);
    chiado(inicio, inicio + duracao + 0.1).connect(filtro).connect(ganho).connect(canal);
  }

  // Grave profundo que desce e some (o "bum" que dá peso ao final da vinheta).
  function grave(canal, inicio, volume = 0.4) {
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.frequency.setValueAtTime(62, inicio);
    osc.frequency.exponentialRampToValueAtTime(36, inicio + 1.6);
    ganho.gain.setValueAtTime(0.0001, inicio);
    ganho.gain.linearRampToValueAtTime(volume, inicio + 0.03);
    ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + 2.2);
    osc.connect(ganho).connect(canal);
    osc.start(inicio);
    osc.stop(inicio + 2.3);
  }

  // ---------- Transição (antes do locutor falar) ----------
  // Chiado de sintonia curto e um sino: a sensação de "voltamos ao estúdio".
  async function transicao(sinal) {
    if (!ctx || (sinal && sinal.aborted)) return;
    const canal = criarCanal(0.8, 0.35, 0.2);
    const t = ctx.currentTime + 0.03;
    sintonia(canal, t, 0.7, 0.14);
    sino(canal, N.E6, t + 0.62, 0.07);
    sino(canal, N.A5, t + 0.74, 0.05);
    await esperar(950, sinal);
    fecharCanal(canal, sinal && sinal.aborted ? 0.1 : 1.5);
  }

  // ---------- Fundo musical (toca por baixo da voz do locutor) ----------
  // Sequência lenta de acordes de sintetizador, um arpejo suave com eco e um
  // leve chiado de fita. Fica bem baixo para não brigar com a voz.
  // Devolve a função que encerra o fundo.
  function iniciarFundo() {
    if (!ctx) return () => {};
    const canal = criarCanal(0, 0.5, 0.3);
    canal.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.9);

    const progressoes = [
      [[N.A2, N.E3, N.G3, N.C4], [N.F2, N.C3, N.E3, N.A3], [N.C3, N.G3, N.B3, N.E4], [N.G2, N.D3, N.G3, N.B3]],
      [[N.F2, N.C3, N.E3, N.A3], [N.G2, N.D3, N.G3, N.B3], [N.A2, N.E3, N.G3, N.C4], [N.A2, N.E3, N.G3, N.C4]],
      [[N.D3, N.A3, N.C4, N.E4], [N.F2, N.C3, N.E3, N.A3], [N.C3, N.G3, N.B3, N.E4], [N.A2, N.E3, N.G3, N.C4]],
    ];
    const acordes = progressoes[Math.floor(Math.random() * progressoes.length)];
    const COMPASSO = 4;   // segundos por acorde
    let indice = 0;

    // Agenda o próximo compasso: o acorde e oito notas de arpejo por cima dele.
    function agendarCompasso() {
      const acorde = acordes[indice++ % acordes.length];
      const t = ctx.currentTime + 0.05;
      pad(canal, acorde, t, COMPASSO + 0.8, 0.011);
      for (let passo = 0; passo < 8; passo++) {
        if (passo % 4 === 3 && Math.random() < 0.5) continue;      // pula algumas notas para respirar
        const frequencia = acorde[(passo * 3) % acorde.length] * (passo % 2 ? 4 : 2);
        nota(canal, frequencia, t + passo * (COMPASSO / 8), 0.5, 'triangle', 0.022);
      }
    }
    agendarCompasso();
    const relogio = setInterval(agendarCompasso, COMPASSO * 1000);

    // Chiado de fita: quase inaudível, mas dá a textura de transmissão antiga.
    const fita = ctx.createBufferSource();
    fita.buffer = ruido;
    fita.loop = true;
    const filtroFita = ctx.createBiquadFilter();
    filtroFita.type = 'highpass';
    filtroFita.frequency.value = 4500;
    const ganhoFita = ctx.createGain();
    ganhoFita.gain.value = 0.006;
    fita.connect(filtroFita).connect(ganhoFita).connect(canal);
    fita.start();

    return () => {
      clearInterval(relogio);
      fecharCanal(canal, 1.2);
      fita.stop(ctx.currentTime + 1.3);
    };
  }

  // ---------- Arquivos de áudio (MP3 da vinheta ou da voz gerada) ----------
  // Toca um Blob e só termina quando o áudio acaba ou o sinal é cancelado.
  // quantoReverb > 0 dá um leve ambiente de estúdio à voz.
  async function tocarBlob(blob, sinal, volume = 1, quantoReverb = 0) {
    if (!ctx || (sinal && sinal.aborted)) return;
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (sinal && sinal.aborted) return;
    const canal = criarCanal(volume, quantoReverb);
    const fonte = ctx.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(canal);
    await new Promise(resolver => {
      fonte.onended = resolver;
      if (sinal) sinal.addEventListener('abort', resolver, { once: true });
      fonte.start();
    });
    try { fonte.stop(); } catch { /* já tinha parado */ }
    fecharCanal(canal, 0.15);
  }

  // ---------- Vinheta ----------
  // falarNome(sinal) é uma função que fala o nome da rádio (vem do locutor).
  async function tocarVinhetaSintetizada(sinal, falarNome) {
    if (!ctx) return;
    const canal = criarCanal(1.5, 0.45, 0.3);
    const t = ctx.currentTime + 0.05;

    // 1. O dial gira até achar a estação.
    sintonia(canal, t, 1.2);
    // 2. A estação "entra": acorde largo crescendo, com um arpejo subindo por cima.
    pad(canal, [N.F2, N.F3, N.A3, N.C4, N.E4], t + 0.8, 4.2, 0.03);
    [N.A4, N.C5, N.E5, N.A5, N.C6, N.E6].forEach((f, i) => nota(canal, f, t + 1.3 + i * 0.13, 0.6, 'triangle', 0.11));
    subida(canal, t + 2.0, 0.9);
    await esperar(3000, sinal);

    // 3. A voz diz o nome da rádio, com o acorde ainda soando ao fundo.
    if (!sinal.aborted) {
      pad(canal, [N.A2, N.E3, N.G3, N.C4], ctx.currentTime, 4.5, 0.016);
      await falarNome(sinal);
    }

    // 4. Fechamento: sinos brilhantes, um grave profundo e o último acorde se dissolvendo.
    if (!sinal.aborted) {
      const f = ctx.currentTime + 0.05;
      grave(canal, f);
      pad(canal, [N.F2, N.C3, N.A3, N.C4, N.E4, N.G4], f, 3.2, 0.028);
      [N.E6, N.C6, N.G5, N.E5].forEach((freq, i) => sino(canal, freq, f + i * 0.14));
      await esperar(2600, sinal);
    }
    fecharCanal(canal, sinal.aborted ? 0.2 : 1.5);
  }

  // Se o usuário enviou vinhetas próprias, sorteia uma; senão usa a sintetizada.
  async function tocarVinheta(sinal, falarNome) {
    let proprias = [];
    try { proprias = await Banco.listarVinhetas(); } catch (e) { console.warn('Não li as vinhetas salvas:', e); }
    if (proprias.length) {
      const sorteada = proprias[Math.floor(Math.random() * proprias.length)];
      try { return await tocarBlob(sorteada.blob, sinal); }
      catch (e) { console.warn('Vinheta "' + sorteada.nome + '" não tocou; usando a sintetizada.', e); }
    }
    await tocarVinhetaSintetizada(sinal, falarNome);
  }

  // Volume que está saindo agora, em decibéis (0 = máximo; -100 = silêncio). Só para testes.
  function nivel() {
    if (!medidor) return -100;
    const amostras = new Float32Array(medidor.fftSize);
    medidor.getFloatTimeDomainData(amostras);
    const media = Math.sqrt(amostras.reduce((soma, a) => soma + a * a, 0) / amostras.length);
    return Math.round(20 * Math.log10(media || 0.00001));
  }

  return { iniciar, esperar, iniciarFundo, transicao, tocarBlob, tocarVinheta, nivel };
})();
