// main.js
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

app.commandLine.appendSwitch('ignore-certificate-errors');

let tempPdfPath = null;
let weighingDataForPdf = null;
let mainWindow;
let ticketWindow;

// --- CAMINHOS INTELIGENTES PARA OS RECURSOS ---
const resourcesPath = app.isPackaged ? process.resourcesPath : __dirname;
const userDataPath = app.getPath('userData');
const obrasFolderPath = path.join(resourcesPath, 'Obras'); 

// --- VARIÁVEIS DE CONFIGURAÇÃO EXTERNA ---
let PLATE_WEIGHTS = {};
let ORDERED_PLATES = []; // NOVO: Armazena as placas na ordem do arquivo
let TICKET_START_NUMBER = 5045; // Valor padrão

// --- FUNÇÃO PARA CARREGAR CONFIGURAÇÕES DE ARQUIVOS EXTERNOS ---
function loadExternalConfigs() {
    // Carregar Placas e Pesos do placas.txt
    const placasConfigPath = path.join(obrasFolderPath, 'placas.txt');
    try {
        if (fs.existsSync(placasConfigPath)) {
            const fileContent = fs.readFileSync(placasConfigPath, 'utf-8');
            const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '' && !line.trim().startsWith('#'));
            
            const loadedPlates = {};
            const loadedOrderedPlates = []; // NOVO: Array para manter a ordem
            lines.forEach(line => {
                const [plate, initial, final] = line.split(';');
                if (plate && initial && final) {
                    const upperPlate = plate.trim().toUpperCase();
                    loadedPlates[upperPlate] = {
                        initial: parseInt(initial.trim(), 10),
                        final: parseInt(final.trim(), 10)
                    };
                    loadedOrderedPlates.push(upperPlate); // NOVO: Adiciona a placa ao array ordenado
                }
            });
            PLATE_WEIGHTS = loadedPlates;
            ORDERED_PLATES = loadedOrderedPlates; // NOVO: Salva o array ordenado
            console.log("Configurações de placas carregadas:", PLATE_WEIGHTS);
            console.log("Ordem das placas carregada:", ORDERED_PLATES);
        } else {
            dialog.showErrorBox('Erro de Configuração', `Arquivo "placas.txt" não encontrado na pasta "Obras". O aplicativo pode não funcionar corretamente.`);
        }
    } catch (error) {
        dialog.showErrorBox('Erro de Configuração', 'Falha ao ler o arquivo "placas.txt". Verifique seu formato.');
        console.error('Erro ao carregar placas.txt:', error);
    }

    // Carregar Número Inicial do Ticket do ticket_config.txt
    const ticketConfigPath = path.join(obrasFolderPath, 'ticket_config.txt');
    try {
        if (fs.existsSync(ticketConfigPath)) {
            const fileContent = fs.readFileSync(ticketConfigPath, 'utf-8').trim();
            const startNumber = parseInt(fileContent, 10);
            if (!isNaN(startNumber)) {
                TICKET_START_NUMBER = startNumber;
                console.log("Número inicial do ticket carregado:", TICKET_START_NUMBER);
            }
        } else {
             fs.writeFileSync(ticketConfigPath, TICKET_START_NUMBER.toString());
        }
    } catch (error) {
        console.error('Erro ao carregar ticket_config.txt:', error);
    }
}

// --- LÓGICA DE CACHE E CONTADORES ---
const cachePath = path.join(userDataPath, 'weighing-cache.json');
const ticketCounterPath = path.join(userDataPath, 'ticket-counter.json');

function getNextTicketNumber() {
    let currentNumber;
    try {
        if (fs.existsSync(ticketCounterPath)) {
            const data = fs.readFileSync(ticketCounterPath, 'utf-8');
            currentNumber = JSON.parse(data).lastTicket;
        } else {
            currentNumber = TICKET_START_NUMBER - 1; 
        }
    } catch (error) {
        console.error("Erro ao ler o contador de ticket, reiniciando.", error);
        currentNumber = TICKET_START_NUMBER - 1;
    }

    const nextNumber = currentNumber + 1;

    try {
        fs.writeFileSync(ticketCounterPath, JSON.stringify({ lastTicket: nextNumber }));
    } catch (error) {
        console.error("Falha ao salvar o próximo número do ticket:", error);
    }
    return nextNumber;
}

// --- COMUNICAÇÃO COM A JANELA (IPC) ---
// ATUALIZADO: Envia tanto os pesos quanto a ordem das placas
ipcMain.handle('get-plate-weights', async () => {
    return {
        weights: PLATE_WEIGHTS,
        order: ORDERED_PLATES
    };
});
ipcMain.on('save-weighings', (event, data) => fs.writeFileSync(cachePath, JSON.stringify(data, null, 2)));
ipcMain.handle('load-weighings', async () => {
    try {
        if (fs.existsSync(cachePath)) return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    } catch (error) { console.error('Falha ao carregar cache:', error); }
    return {};
});

ipcMain.on('get-obras-data', (event) => {
    const transportadoraPath = path.join(obrasFolderPath, 'Transportadora.txt');
    if (!fs.existsSync(transportadoraPath)) {
        dialog.showErrorBox('Erro Crítico de Arquivo', `Arquivo 'Transportadora.txt' não encontrado.`);
        return event.reply('obras-data-reply', []); 
    }
    try {
        const fileContent = fs.readFileSync(transportadoraPath, 'utf-8');
        const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '' && !line.trim().startsWith('#'));
        if (lines[0] && lines[0].toLowerCase().includes('nome da pasta')) lines.shift();
        const parsedData = lines.map(line => ({
            code: (line.split(/-(.+)/s)[0] || '').trim(),
            description: line.trim()
        })).filter(item => item.code && item.description); 
        event.reply('obras-data-reply', parsedData);
    } catch (error) {
        console.error('Erro ao ler Transportadora.txt:', error);
        event.reply('obras-data-reply', []);
    }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 720,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  mainWindow.loadFile("index.html");
}

async function createTicketWindow(pdfPath) {
    if (ticketWindow) ticketWindow.close();
    ticketWindow = new BrowserWindow({
        width: 800, height: 600, title: 'Comprovante', parent: mainWindow, modal: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false, plugins: true }
    });
    await ticketWindow.loadFile(pdfPath);
    ticketWindow.on('closed', () => {
        if (tempPdfPath && fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
        tempPdfPath = null;
        ticketWindow = null;
    });
    ticketWindow.webContents.on('did-finish-load', () => {
        ticketWindow.webContents.executeJavaScript(`
            document.body.style.margin='0'; document.body.style.overflow='hidden';
            if(document.querySelector('embed')) document.querySelector('embed').style.height='100vh';
            const b=document.createElement('button'); b.innerText='Salvar PDF';
            b.style.cssText='position:fixed;top:10px;right:10px;padding:8px 15px;border:1px solid #555;border-radius:4px;background-color:#0D47A1;color:white;cursor:pointer;z-index:1000;';
            b.onclick=()=>require('electron').ipcRenderer.send('save-pdf-dialog');
            document.body.appendChild(b);
        `);
    });
}

ipcMain.on('show-ticket', async (event, data) => {
    weighingDataForPdf = data;
    const { contrato, placa, pesoInicial, dataInicio, pesoFinal, dataFinal, ...rest } = data;
    const pesoLiquido = pesoFinal - pesoInicial;
    const formattedTicket = String(getNextTicketNumber()).padStart(7, '0');
    const emissaoDateTime = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // --- Definição das coordenadas e fontes (usado para Tamoio e Chapero) ---
    const tamoioCoords = {
        ticketPesagem: { x: 160, y: 628, size: 10 }, 
        emissaoDataHora: { x: 480, y: 740 },
        transportadoraDesc: { x: 65, y: 550 },
        emissorDesc: { x: 65, y: 505 },
        itemDesc: { x: 65, y: 465 },
        placaCarreta: { x: 100, y: 590 },
        placaVeiculo: { x: 280, y: 590 },
        dataInicio: { x: 280, y: 405 },
        pesoInicial: { x: 344, y: 370 },
        dataFinal: { x: 460, y: 405 },
        pesoFinal: { x: 520, y: 370 },
        pesoLiquido: { x: 67, y: 272, size: 9 },
        liqCorrigido: { x: 246, y: 272, size: 9 }
    };
    
    // --- Lógica para determinar o caminho do PDF base ---
    let pdfTemplatePath;
    if (contrato === '002') { // Contrato CHAPERÓ
        pdfTemplatePath = path.join(resourcesPath, 'pdf', 'Modelo Chapero.pdf');
    } else { // Contrato TAMOIO (ou qualquer outro)
        pdfTemplatePath = path.join(resourcesPath, 'pdf', 'Modelo Tamoio.pdf');
    }

    if (!fs.existsSync(pdfTemplatePath)) {
        dialog.showErrorBox('Erro de Arquivo', `O arquivo de modelo PDF não foi encontrado em:\n${pdfTemplatePath}`);
        return;
    }

    // --- Lógica unificada para processar o PDF ---
    try {
        const pdfDoc = await PDFDocument.load(fs.readFileSync(pdfTemplatePath));
        const page = pdfDoc.getPages()[0];

        const embeddedFonts = {
            'Helvetica': await pdfDoc.embedFont(StandardFonts.Helvetica),
            'Helvetica-Bold': await pdfDoc.embedFont(StandardFonts.HelveticaBold),
            'Times-Roman': await pdfDoc.embedFont(StandardFonts.TimesRoman),
            'Times-Roman-Bold': await pdfDoc.embedFont(StandardFonts.TimesRomanBold)
        };

        // --- Lógica de preenchimento unificada ---
        const coords = tamoioCoords; // Usa as mesmas coordenadas para ambos
        const textMap = { 
            ...rest, 
            ticketPesagem: formattedTicket, 
            emissaoDataHora: emissaoDateTime, 
            dataInicio, 
            dataFinal, 
            pesoInicial: `${pesoInicial} kg`, 
            pesoFinal: `${pesoFinal} kg`, 
            pesoLiquido: `${pesoLiquido} kg`, 
            liqCorrigido: `${pesoLiquido} kg` 
        };

        for (const [key, text] of Object.entries(textMap)) {
            const field = coords[key];
            if (field && text !== undefined) {
                page.drawText(String(text), {
                    x: field.x, y: field.y, size: field.size || 8,
                    font: embeddedFonts[field.font] || embeddedFonts['Helvetica'], color: rgb(0, 0, 0)
                });
            }
        }

        const modifiedPdfBytes = await pdfDoc.save();
        const backupDir = path.join(path.dirname(app.getPath('exe')), 'Comprovantes Salvos');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFilePath = path.join(backupDir, `pesagem-${placa}-${timestamp}-ticket-${formattedTicket}.pdf`);
        fs.writeFileSync(backupFilePath, modifiedPdfBytes);

        tempPdfPath = path.join(app.getPath('temp'), `ticket-${Date.now()}.pdf`);
        fs.writeFileSync(tempPdfPath, modifiedPdfBytes);
        createTicketWindow(tempPdfPath);
    } catch (error) {
        console.error('Erro ao gerar/modificar PDF:', error);
        dialog.showErrorBox('Erro de PDF', 'Ocorreu um erro ao processar o arquivo PDF.');
    }
});

ipcMain.on('save-pdf-dialog', (event) => {
    if (!tempPdfPath || !weighingDataForPdf) return;
    dialog.showSaveDialog({
        title: 'Salvar PDF', defaultPath: `pesagem-${weighingDataForPdf.placa}.pdf`,
        filters: [{ name: 'Arquivos PDF', extensions: ['pdf'] }]
    }).then(({ canceled, filePath }) => {
        if (!canceled && filePath) {
            fs.copyFile(tempPdfPath, filePath, (err) => {
                if (err) dialog.showErrorBox('Erro ao Salvar', 'Não foi possível salvar o arquivo.');
                else dialog.showMessageBox({ type: 'info', title: 'Sucesso', message: 'PDF salvo com sucesso!' });
            });
        }
    }).catch(err => console.log(err));
});

app.whenReady().then(() => {
  loadExternalConfigs(); // Carrega configs ANTES de criar a janela
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
