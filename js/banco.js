// banco.js — IndexedDB: um banco de dados que vive dentro do navegador.
// Diferente do localStorage (só texto, ~5 MB), ele guarda arquivos (Blob),
// então serve para as vinhetas em MP3 e para o cache dos áudios do locutor.
//
// Tabelas ("stores"):
//   vinhetas -> { id (automático), nome, blob }
//   audios   -> chave = texto identificador, valor = Blob do áudio

const Banco = (() => {
  let promessaDb = null;

  function abrir() {
    if (!promessaDb) {
      promessaDb = new Promise((resolver, rejeitar) => {
        const pedido = indexedDB.open('radio-pessoal', 1);
        // Roda só quando o banco é criado (ou a versão muda): cria as tabelas.
        pedido.onupgradeneeded = () => {
          const db = pedido.result;
          db.createObjectStore('vinhetas', { keyPath: 'id', autoIncrement: true });
          db.createObjectStore('audios');
        };
        pedido.onsuccess = () => resolver(pedido.result);
        pedido.onerror = () => rejeitar(pedido.error);
      });
    }
    return promessaDb;
  }

  // Executa uma operação e devolve uma Promise com o resultado.
  // (A API do IndexedDB usa eventos; aqui embrulhamos em Promise para poder usar await.)
  async function operar(tabela, modo, acao) {
    const db = await abrir();
    return new Promise((resolver, rejeitar) => {
      const pedido = acao(db.transaction(tabela, modo).objectStore(tabela));
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rejeitar(pedido.error);
    });
  }

  return {
    listarVinhetas: () => operar('vinhetas', 'readonly', t => t.getAll()),
    adicionarVinheta: (nome, blob) => operar('vinhetas', 'readwrite', t => t.add({ nome, blob })),
    removerVinheta: id => operar('vinhetas', 'readwrite', t => t.delete(id)),

    lerAudio: chave => operar('audios', 'readonly', t => t.get(chave)),
    gravarAudio: (chave, blob) => operar('audios', 'readwrite', t => t.put(blob, chave)),
  };
})();
