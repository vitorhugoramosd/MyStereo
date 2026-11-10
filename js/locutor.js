// locutor.js — escreve a fala (Claude ou frases prontas) e transforma em voz
// (voz do navegador ou OpenAI TTS).

const Locutor = (() => {
  const ultimasFalas = [];   // memória curta, para o Claude não repetir bordões

  // ---------- Roteiro ----------

  function horaCerta() {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function periodoDoDia() {
    const h = new Date().getHours();
    return h < 6 ? 'madrugada' : h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite';
  }

  function sortear(lista) { return lista[Math.floor(Math.random() * lista.length)]; }

  // Frases prontas: usadas sem chave do Claude ou quando a API falha.
  function fraseReserva({ anterior, proxima }) {
    const radio = Config.valores.nomeRadio;
    const prox = `${proxima.nome}, de ${proxima.artistas}`;
    const comAnterior = anterior ? [
      `Você ouviu ${anterior.nome}, de ${anterior.artistas}. E a ${radio} segue com ${prox}.`,
      `Essa foi ${anterior.nome}. Sem parar, agora vem ${prox}, aqui na ${radio}.`,
      `${anterior.artistas} passando pela ${radio}. São ${horaCerta()}, e a próxima é ${prox}.`,
      `Que som, hein? ${anterior.nome} ficou pra trás, e agora é a vez de ${prox}.`,
    ] : [
      `Está no ar a ${radio}! Para começar esta ${periodoDoDia()}, ${prox}.`,
      `Muito boa ${periodoDoDia()}! Você está na ${radio}, e a primeira de hoje é ${prox}.`,
    ];
    return sortear(comAnterior);
  }

  // Frases prontas em inglês, no clima "rádio etérea da madrugada".
  function fraseReservaIngles({ anterior, proxima }) {
    const radio = Config.valores.nomeRadio;
    const prox = `${proxima.nome}, by ${proxima.artistas}`;
    const comAnterior = anterior ? [
      `That was ${anterior.nome}. Let it drift away now. You are still here, with ${radio}, and the road ahead is quiet. Next, ${prox}.`,
      `Don't touch that dial. ${anterior.artistas} has faded into the dark behind us. Breathe in. Here comes ${prox}.`,
      `You've been in this tunnel a long time, haven't you? Stay with ${radio}. There is light up ahead, and it sounds like ${prox}.`,
      `No rush. No traffic. Just you and ${radio}, somewhere between yesterday and whatever comes next. This is ${prox}.`,
    ] : [
      `You are now tuned in to ${radio}. Unclench your jaw. Loosen your grip. We'll take it from here. First, ${prox}.`,
      `Welcome back to ${radio}, the only station still broadcasting at this hour of your life. Relax. This is ${prox}.`,
    ];
    return sortear(comAnterior);
  }

  function montarPromptIngles() {
    const c = Config.valores;
    return [
      `You are the host of "${c.nomeRadio}", a mysterious late-night FM station that seems to broadcast from somewhere between sleep and waking.`,
      'Write the short spoken interlude that airs between two songs: gently let go of the song that just played (if any) and usher in the next one.',
      'Voice: serene, hypnotic, soothing and a little uncanny, like a guide leading the listener through a long dark tunnel toward the light. Calm reassurance, cosmic imagery, and a touch of dry, deadpan humor.',
      'Rules:',
      '- English only. 2 to 4 sentences, 55 words at most.',
      '- Reply with only the words to be spoken aloud: no quotes, emojis, stage directions, lists or markdown.',
      '- Write original lines. Never quote or paraphrase lyrics, albums or real radio shows.',
      '- Say the station name now and then. Only mention the time when the request tells you to.',
      '- Only state a fact about the song or artist if you are absolutely certain; otherwise speak about the mood.',
      '- Do not reuse openings or catchphrases from the recent lines you are given.',
    ].join('\n');
  }

  // Decide em que idioma sai a próxima fala, conforme a configuração.
  function sortearIdioma() {
    const estilo = Config.valores.locucaoEstilo;
    if (estilo === 'ingles') return 'en';
    if (estilo === 'misto') return Math.random() < 0.4 ? 'en' : 'pt';
    return 'pt';
  }

  function montarPrompt() {
    const c = Config.valores;
    return [
      `Você é ${c.locutorNome}, locutor da rádio FM "${c.nomeRadio}". Seu estilo: ${c.locutorEstilo}.`,
      c.locutorGirias ? `Use de vez em quando, com naturalidade, gírias ou bordões como: ${c.locutorGirias}.` : '',
      'Escreva a fala que vai ao ar entre duas músicas: comente brevemente a que acabou de tocar (se houver) e anuncie a próxima.',
      'Regras:',
      '- Português do Brasil, tom de locutor de FM, caloroso e com energia.',
      '- De 2 a 4 frases, no máximo 55 palavras.',
      '- Responda só com a fala pronta para ser lida em voz alta: sem aspas, emojis, rubricas, listas ou markdown.',
      '- Só cite um fato sobre a música, o álbum ou o artista se tiver certeza absoluta. Na dúvida, fale do clima da música ou do momento do dia.',
      '- Só diga a hora quando o pedido mandar.',
      '- Não repita aberturas, bordões ou construções das falas recentes que receber.',
    ].filter(Boolean).join('\n');
  }

  function descrever(faixa) {
    return `"${faixa.nome}", de ${faixa.artistas}` + (faixa.album ? ` (álbum "${faixa.album}"${faixa.ano ? ', ' + faixa.ano : ''})` : '');
  }

  async function escreverComClaude({ anterior, proxima, programa }, idioma) {
    const c = Config.valores;
    const pedido = idioma === 'en' ? [
      anterior ? `Just played: ${descrever(anterior)}.` : 'The station has just been switched on; this is the opening line.',
      `Next song: ${descrever(proxima)}.`,
      Math.random() < 0.2 ? `Mention the time: ${horaCerta()}.` : 'Do not mention the time.',
      ultimasFalas.length ? 'Recent lines (do not repeat their openings or catchphrases):\n' + ultimasFalas.map(f => '- ' + f).join('\n') : '',
    ].filter(Boolean).join('\n') : [
      anterior ? `Acabou de tocar: ${descrever(anterior)}.` : 'A rádio acabou de ser ligada; esta é a fala de abertura.',
      `Próxima música: ${descrever(proxima)}.`,
      `Agora é ${periodoDoDia()}.`,
      programa ? `Programa no ar: "${programa}".` : '',
      Math.random() < 0.25 ? `Diga a hora certa: ${horaCerta()}.` : 'Não diga a hora desta vez.',
      ultimasFalas.length ? 'Falas recentes (não repita o jeito de começar nem os bordões):\n' + ultimasFalas.map(f => '- ' + f).join('\n') : '',
    ].filter(Boolean).join('\n');

    const resposta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': c.claudeKey.trim(),
        'anthropic-version': '2023-06-01',
        // Sem este cabeçalho a API recusa chamadas feitas direto do navegador.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: c.claudeModelo.trim() || 'claude-haiku-4-5',
        max_tokens: 400,
        system: idioma === 'en' ? montarPromptIngles() : montarPrompt(),
        messages: [{ role: 'user', content: pedido }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(`Claude ${resposta.status}: ${(dados.error && dados.error.message) || 'erro'}`);
    if (dados.stop_reason === 'refusal') throw new Error('O Claude recusou o pedido.');
    const texto = (dados.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
    if (!texto) throw new Error('O Claude devolveu uma fala vazia.');
    return texto.replace(/["“”*_#]/g, '');   // tira aspas e marcações que o leitor de voz leria em voz alta
  }

  // ---------- Voz ----------

  function listarVozes() {
    return speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('pt'));
  }

  // Preferência: a voz escolhida > vozes neurais do Edge ("Natural") > Google > qualquer pt-BR.
  function escolherVoz(idioma) {
    if (idioma === 'en') {
      const ingles = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('en'));
      return ingles.find(v => v.name.includes('Natural') && v.lang === 'en-US')
        || ingles.find(v => v.name.includes('Natural'))
        || ingles.find(v => v.lang === 'en-US')
        || ingles[0] || null;
    }
    const vozes = listarVozes();
    return vozes.find(v => v.name === Config.valores.vozNavegador)
      || vozes.find(v => v.lang === 'pt-BR' && v.name.includes('Natural'))
      || vozes.find(v => v.lang === 'pt-BR' && v.name.includes('Google'))
      || vozes.find(v => v.lang === 'pt-BR')
      || vozes[0] || null;
  }

  let falaAtual = null;   // manter a referência evita um bug do Chrome que corta a fala no meio

  function falarComNavegador(texto, sinal, idioma = 'pt') {
    return new Promise(resolver => {
      if (sinal.aborted) return resolver();
      const fala = new SpeechSynthesisUtterance(texto);
      const ingles = idioma === 'en';
      fala.lang = ingles ? 'en-US' : 'pt-BR';
      const voz = escolherVoz(idioma);
      if (voz) fala.voice = voz;
      fala.rate = ingles ? 0.9 : 1.05;     // em inglês: mais devagar e mais grave, para o clima sereno
      fala.pitch = ingles ? 0.85 : 1;
      falaAtual = fala;

      // Garantia: se o navegador nunca avisar que terminou, seguimos em frente mesmo assim.
      const limite = setTimeout(terminar, 8000 + texto.length * 110);
      function terminar() { clearTimeout(limite); resolver(); }

      fala.onend = terminar;
      fala.onerror = terminar;
      sinal.addEventListener('abort', () => { speechSynthesis.cancel(); terminar(); }, { once: true });
      speechSynthesis.cancel();   // limpa qualquer fala presa na fila
      speechSynthesis.speak(fala);
    });
  }

  // Gera o MP3 da fala na OpenAI. Falas iguais (ex.: nome da rádio) vêm do cache no IndexedDB.
  async function gerarAudioOpenAI(texto, idioma = 'pt') {
    const c = Config.valores;
    const chaveCache = `openai|${c.openaiVoz}|${idioma}|${texto}`;
    try {
      const salvo = await Banco.lerAudio(chaveCache);
      if (salvo) return salvo;
    } catch { /* sem cache, segue e gera */ }

    const resposta = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.openaiKey.trim() },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: c.openaiVoz,
        input: texto,
        instructions: idioma === 'en'
          ? 'Speak in English as a serene, hypnotic late-night radio host: slow, warm, soothing, slightly uncanny.'
          : `Fale em português do Brasil como locutor de rádio FM: ${c.locutorEstilo}.`,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!resposta.ok) throw new Error('OpenAI TTS ' + resposta.status);
    const blob = await resposta.blob();
    Banco.gravarAudio(chaveCache, blob).catch(() => {});
    return blob;
  }

  const usaOpenAI = () => Config.valores.vozTipo === 'openai' && Config.valores.openaiKey.trim();

  // ---------- Funções públicas ----------

  // Deixa a fala pronta com antecedência (texto e, se for OpenAI, o áudio).
  // Nunca dá erro: se algo falhar, cai na frase pronta e na voz do navegador.
  async function preparar(contexto) {
    const idioma = sortearIdioma();
    let texto;
    if (Config.valores.claudeKey.trim()) {
      try { texto = await escreverComClaude(contexto, idioma); }
      catch (e) { console.warn('Roteiro pelo Claude falhou; usando frase pronta.', e); }
    }
    if (!texto) texto = idioma === 'en' ? fraseReservaIngles(contexto) : fraseReserva(contexto);

    let audio = null;
    if (usaOpenAI()) {
      try { audio = await gerarAudioOpenAI(texto, idioma); }
      catch (e) { console.warn('OpenAI TTS falhou; usando a voz do navegador.', e); }
    }
    return { texto, audio, idioma };
  }

  // Fala sem fundo musical (usada na vinheta, para dizer o nome da rádio).
  async function falarTexto(texto, sinal, idioma = 'pt') {
    if (usaOpenAI()) {
      try { return await Som.tocarBlob(await gerarAudioOpenAI(texto, idioma), sinal); }
      catch (e) { console.warn('OpenAI TTS falhou; usando a voz do navegador.', e); }
    }
    await falarComNavegador(texto, sinal, idioma);
  }

  // Põe no ar uma fala já preparada, com o fundo musical por baixo.
  async function falar(preparada, sinal) {
    const pararFundo = Config.valores.fundoMusical ? Som.iniciarFundo() : () => {};
    try {
      await Som.esperar(500, sinal);   // o fundo entra um instante antes da voz
      if (preparada.audio) {
        try { await Som.tocarBlob(preparada.audio, sinal); }
        catch (e) { console.warn('Áudio da fala não tocou; usando a voz do navegador.', e); await falarComNavegador(preparada.texto, sinal, preparada.idioma); }
      } else {
        await falarComNavegador(preparada.texto, sinal, preparada.idioma);
      }
      await Som.esperar(300, sinal);
    } finally {
      pararFundo();
    }
    ultimasFalas.push(preparada.texto);
    if (ultimasFalas.length > 4) ultimasFalas.shift();
  }

  // Usada na vinheta: diz o nome da rádio (em inglês quando o estilo é só inglês).
  function falarNomeDaRadio(sinal) {
    const nome = Config.valores.nomeRadio;
    return Config.valores.locucaoEstilo === 'ingles'
      ? falarTexto(`You are listening to ${nome}.`, sinal, 'en')
      : falarTexto(nome, sinal, 'pt');
  }

  return { preparar, falar, falarNomeDaRadio, fraseReserva, listarVozes };
})();
