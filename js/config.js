// config.js — guarda as configurações no localStorage do navegador.
//
// Padrão usado em todos os arquivos: "const Nome = (() => { ... return {...}; })();"
// Isso é uma função que roda uma vez e devolve um objeto. Funciona como uma
// classe estática do C#: o que está no "return" é público, o resto é privado.

const Config = (() => {
  const CHAVE = 'radio-pessoal:config';

  const PADRAO = {
    nomeRadio: 'Rádio Pessoal FM',
    clientId: '',
    fonte: 'curtidas',          // 'curtidas' ou o id de uma playlist
    vinhetaACada: 4,
    falaACada: 1,
    volume: 0.8,
    fundoMusical: true,

    usarProgramas: false,
    programas: [
      { nome: 'Madrugada tranquila', inicio: 0,  fonte: 'curtidas' },
      { nome: 'Manhã animada',       inicio: 6,  fonte: 'curtidas' },
      { nome: 'Tarde no embalo',     inicio: 12, fonte: 'curtidas' },
      { nome: 'Noite calma',         inicio: 18, fonte: 'curtidas' },
    ],

    locucaoEstilo: 'fm',        // 'fm' (português), 'ingles' (rádio etérea da madrugada) ou 'misto'
    locutorNome: 'Léo',
    locutorEstilo: 'caloroso, bem-humorado e com energia',
    locutorGirias: '',
    claudeKey: '',
    claudeModelo: 'claude-haiku-4-5',

    vozTipo: 'navegador',       // 'navegador' ou 'openai'
    vozNavegador: '',
    openaiKey: '',
    openaiVoz: 'ash',
  };

  // Começa com o padrão e sobrepõe o que estiver salvo.
  // structuredClone faz uma cópia completa (para não alterar o PADRAO).
  const valores = structuredClone(PADRAO);
  try {
    Object.assign(valores, JSON.parse(localStorage.getItem(CHAVE) || '{}'));
  } catch (e) {
    console.warn('Configuração salva inválida; usando o padrão.', e);
  }

  function salvar() {
    localStorage.setItem(CHAVE, JSON.stringify(valores));
  }

  // Programa (faixa de horário) que vale agora. Devolve null se o recurso está desligado.
  function programaAtual() {
    if (!valores.usarProgramas) return null;
    const hora = new Date().getHours();
    let atual = valores.programas[0];
    for (const p of valores.programas) if (hora >= p.inicio) atual = p;
    return atual;
  }

  return { valores, salvar, programaAtual };
})();
