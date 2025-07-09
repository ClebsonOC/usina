const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

// A porta será fornecida pelo ambiente do Render, ou 3000 para teste local.
const PORT = process.env.PORT || 3000;

// Configuração do Servidor Web (Express)
const app = express();
// Serve os arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal para servir o remote.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'remote.html'));
});

const server = http.createServer(app);

// Configuração do Servidor WebSocket (ws)
const wss = new WebSocketServer({ server });

// Armazenaremos as conexões para saber para quem enviar os comandos.
let electronClient = null;
let remoteClients = new Set();

// Função para o heartbeat (manter a conexão viva)
function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', (ws) => {
  console.log('Cliente conectado.');
  // Adiciona a propriedade isAlive e o listener de pong para o heartbeat
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(Buffer.from(message).toString());

      if (data.type === 'register_electron') {
        console.log('Aplicação Electron registrada.');
        electronClient = ws;
        electronClient.send(JSON.stringify({ type: 'status', message: 'Conectado ao servidor.' }));
      } else if (data.type === 'register_remote') {
        console.log('Controle remoto (celular) conectado.');
        remoteClients.add(ws);
      }

      if (data.type === 'command' && electronClient && electronClient.readyState === ws.OPEN) {
        console.log(`Comando recebido do controle remoto: ${data.key}`);
        electronClient.send(JSON.stringify({ type: 'execute_command', key: data.key }));
      }

      if (data.type === 'status_update' && remoteClients.size > 0) {
         console.log(`Status do Electron recebido: ${data.payload.status}`);
         remoteClients.forEach(client => {
            if (client.readyState === ws.OPEN) {
                client.send(JSON.stringify(data));
            }
         });
      }
    } catch (e) {
      console.log('Mensagem de ping/pong ou inválida recebida.');
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

// Intervalo para verificar conexões e enviar pings
const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) {
        console.log('Cliente não respondeu ao ping, terminando conexão.');
        return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });
}, 30000); // Envia um ping a cada 30 segundos

// Limpa o intervalo quando o servidor fecha
wss.on('close', function close() {
  clearInterval(interval);
});

// Inicia o servidor
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
