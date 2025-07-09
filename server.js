const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'remote.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let electronClient = null;
let remoteClients = new Set();

// Função para notificar todos os controles remotos sobre o status do desktop
function broadcastDesktopStatus(status) {
    const message = JSON.stringify({ type: 'desktop_status', status: status });
    remoteClients.forEach(client => {
        if (client.readyState === ws.OPEN) {
            client.send(message);
        }
    });
}

// Função para o heartbeat (manter a conexão viva)
function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', (ws) => {
  console.log('Cliente conectado.');
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(Buffer.from(message).toString());

      if (data.type === 'register_electron') {
        console.log('Aplicação Electron registrada.');
        electronClient = ws;
        broadcastDesktopStatus('online'); // Notifica que o desktop está online
      } else if (data.type === 'register_remote') {
        console.log('Controle remoto (celular) conectado.');
        remoteClients.add(ws);
        // Informa imediatamente ao novo controle se o desktop já está online
        if (electronClient && electronClient.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'desktop_status', status: 'online' }));
        }
      }

      if (data.type === 'command' && electronClient && electronClient.readyState === ws.OPEN) {
        console.log(`Comando recebido: ${data.key}`);
        electronClient.send(JSON.stringify({ type: 'execute_command', key: data.key }));
      }

      if (data.type === 'status_update' && remoteClients.size > 0) {
         console.log(`Status do Electron: ${data.payload.status}`);
         remoteClients.forEach(client => {
            if (client.readyState === ws.OPEN) {
                client.send(JSON.stringify(data));
            }
         });
      }
    } catch (e) {
      console.log('Mensagem inválida ou de ping/pong.');
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado.');
    if (ws === electronClient) {
      electronClient = null;
      console.log('Aplicação Electron desconectada.');
      broadcastDesktopStatus('offline'); // Notifica que o desktop ficou offline
    }
    if(remoteClients.has(ws)){
       remoteClients.delete(ws);
       console.log('Controle remoto desconectado.');
    }
  });

  ws.on('error', (error) => console.error('Erro de WebSocket:', error));
});

const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
