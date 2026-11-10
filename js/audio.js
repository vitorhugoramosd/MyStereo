// audio.js — sons gerados pela própria página com a Web Audio API:
// fundo musical do locutor, vinheta sintetizada e reprodução de arquivos (MP3).
//
// Web Audio funciona como uma mesa de som: você cria "nós" (osciladores,
// volumes, filtros) e liga um no outro até chegar na saída (destination).
//
// "sinal" (AbortSignal) aparece em várias funções: é o aviso de cancelamento.
// Quando o usuário clica em Pular, o sinal dispara e o som para na hora.
// É o equivalente ao CancellationToken do C#.

// O nome é Som (e não Audio) porque o navegador já tem um objeto global "Audio".
const Som = (() => {
  let ctx = null;   // AudioContext: o "motor" de áudio. Só pode nascer dentro de um clique.

  function iniciar() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
  }

  // Espera "ms" milissegundos, ou menos se o sinal for cancelado.
  function esperar(ms, sinal) {
    return new Promise(resolver => {
      if (sinal && sinal.aborted) return resolver();
      const timer = setTimeout(resolver, ms);
      if (sinal) sinal.addEventListener('abort', () => { clearTimeout(timer); resolver(); }, { once: true });
    });
  }

  // Cria um controle de volume ligado na saída. Tudo que um trecho toca passa
  // por ele; para cortar o trecho, basta zerar e desligar esse nó.
  function criarCanal(volume) {
    const canal = ctx.createGain();
    canal.gain.value = volume;
    canal.connect(ctx.destination);
    return canal;
  }

  function fecharCanal(canal, segundos = 0.3) {
    const agora = ctx.currentTime;
    canal.gain.cancelScheduledValues(agora);
    canal.gain.setValueAtTime(canal.gain.value, agora);
    canal.gain.linearRampToValueAtTime(0, agora + segundos);
    setTimeout(() => canal.disconnect(), segundos * 1000 + 100);
  }

  // Agenda uma nota: liga um oscilador em "inicio" e apaga suavemente em "duracao" segundos.
  function nota(canal, frequencia, inicio, duracao, tipo = 'triangle', volume = 0.25) {
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = tipo;
    osc.frequency.value = frequencia;
    ganho.gain.setValueAtTime(0, inicio);
    ganho.gain.linearRampToValueAtTime(volume, inicio + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.001, inicio + duracao);
    osc.connect(ganho).connect(canal);
    osc.start(inicio);
    osc.stop(inicio + duracao + 0.05);
  }

  // ---------- Fundo musical (toca por baixo da voz do locutor) ----------
  // Um acorde contínuo e suave, com um filtro que abre e fecha devagar.
  // Devolve a função que encerra o fundo.
  function iniciarFundo() {
    if (!ctx) return () => {};
    const canal = criarCanal(0);
    canal.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 0.8);

    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 900;
    filtro.connect(canal);

    // LFO = oscilador bem lento que mexe em outro parâmetro (aqui, o filtro).
    const lfo = ctx.createOscillator();
    const lfoGanho = ctx.createGain();
    lfo.frequency.value = 0.15;
    lfoGanho.gain.value = 350;
    lfo.connect(lfoGanho).connect(filtro.frequency);
    lfo.start();

    // Sorteia um de três acordes para o fundo não ser sempre igual.
    const acordes = [
      [130.81, 196.00, 261.63, 329.63],   // Dó maior
      [146.83, 220.00, 293.66, 349.23],   // Ré menor
      [174.61, 261.63, 349.23, 440.00],   // Fá maior
    ];
    const osciladores = acordes[Math.floor(Math.random() * acordes.length)].map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = (i - 1.5) * 6;   // leve desafinação deixa o som mais "cheio"
      osc.connect(filtro);
      osc.start();
      return osc;
    });

    return () => {
      fecharCanal(canal, 0.8);
      setTimeout(() => { osciladores.forEach(o => o.stop()); lfo.stop(); }, 1000);
    };
  }

  // ---------- Arquivos de áudio (MP3 da vinheta ou da voz gerada) ----------
  // Toca um Blob e só termina quando o áudio acaba ou o sinal é cancelado.
  async function tocarBlob(blob, sinal, volume = 1) {
    if (!ctx || (sinal && sinal.aborted)) return;
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (sinal && sinal.aborted) return;
    const canal = criarCanal(volume);
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
    const canal = criarCanal(0.9);
    const t = ctx.currentTime + 0.05;

    // Abertura: arpejo subindo (notas de um acorde tocadas uma depois da outra).
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => nota(canal, f, t + i * 0.11, 0.5));
    // Acorde sustentado no final do arpejo.
    [261.63, 392.00, 523.25, 659.25].forEach(f => nota(canal, f, t + 0.45, 1.3, 'sawtooth', 0.07));
    await esperar(1100, sinal);

    if (!sinal.aborted) await falarNome(sinal);

    // Fechamento: duas notas, tipo "tan-tan".
    if (!sinal.aborted) {
      const f = ctx.currentTime + 0.05;
      nota(canal, 783.99, f, 0.35);
      nota(canal, 1046.5, f + 0.16, 0.9);
      [523.25, 659.25].forEach(freq => nota(canal, freq, f + 0.16, 0.9, 'sine', 0.12));
      await esperar(1100, sinal);
    }
    fecharCanal(canal, 0.2);
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

  return { iniciar, esperar, iniciarFundo, tocarBlob, tocarVinheta };
})();
