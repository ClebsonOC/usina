// server.js
const { WebSocketServer } = require('ws');

// A porta será fornecida pelo ambiente do Render, ou 8080 para teste local.
const PORT = process.env.PORT || 8080; 

const wss = new WebSocketServer({ port: PORT });

// Armazenaremos as conexões para saber para quem enviar os comandos.
// Em uma aplicação real, você pode querer uma lógica mais robusta para parear um celular com um desktop específico.
let electronClient = null;
let remoteClients = new Set();

wss.on('connection', (ws) => {
  console.log('Cliente conectado.');

  // Lógica para identificar quem está conectando (Desktop ou Celular)
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // 1. Registro de clientes
      if (data.type === 'register_electron') {
        console.log('Aplicação Electron registrada.');
        electronClient = ws;
        // Informa ao Electron que ele está conectado
        electronClient.send(JSON.stringify({ type: 'status', message: 'Conectado ao servidor.' }));
      } else if (data.type === 'register_remote') {
        console.log('Controle remoto (celular) conectado.');
        remoteClients.add(ws);
      }

      // 2. Recebendo comando do celular e enviando para o Electron
      if (data.type === 'command' && electronClient) {
        console.log(`Comando recebido do controle remoto: ${data.key}`);
        electronClient.send(JSON.stringify({ type: 'execute_command', key: data.key }));
      }

      // 3. Recebendo status do Electron e enviando para os celulares
      if (data.type === 'status_update' && remoteClients.size > 0) {
         console.log(`Status do Electron recebido: ${data.payload.status}`);
         remoteClients.forEach(client => {
            if (client.readyState === ws.OPEN) {
                client.send(JSON.stringify(data));
            }
         });
      }

    } catch (e) {
      console.error('Mensagem inválida recebida:', message);
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado.');
    if (ws === electronClient) {
      electronClient = null;
      console.log('Aplicação Electron desconectada.');
    }
    if(remoteClients.has(ws)){
       remoteClients.delete(ws);
       console.log('Controle remoto desconectado.');
    }
  });

  ws.on('error', (error) => {
    console.error('Erro de WebSocket:', error);
  });
});

console.log(`Servidor WebSocket rodando na porta ${PORT}`);