/**
 * Script.js com lógica de pátio e cache para persistir os dados
 * de pesagens pendentes. As configurações de placas são carregadas dinamicamente.
 * Implementa um novo fluxo de pesagem com atalhos F1-F6 e a nova lógica para F8/F9.
 * * Versão com integração WebSocket para controle remoto.
 */
document.addEventListener("DOMContentLoaded", () => {
    const { ipcRenderer } = require('electron');

    // --- ELEMENTOS DO DOM ---
    const datetimeElement = document.getElementById("datetime");
    const placaCarretaInput = document.getElementById("placa-carreta");
    const placaVeiculoInput = document.getElementById("placa-veiculo");
    const btnConfirmWeighing = document.getElementById("btn-confirm-weighing");
    const weightValue = document.getElementById("weight-value");
    const weighingStatus = document.getElementById("weighing-status");
    const contratoSelect = document.getElementById('contrato-select');
    const contratoDesc = document.getElementById('contrato-desc');
    const transportadoraSelect = document.getElementById('transportadora-select');
    const transportadoraDesc = document.getElementById('transportadora-desc');
    const emissorSelect = document.getElementById('emissor-select');
    const emissorDesc = document.getElementById('emissor-desc');
    const itemSelect = document.getElementById('item-select');
    const itemDesc = document.getElementById('item-desc');
    const customModal = document.getElementById("custom-modal");
    const modalMessage = document.getElementById("modal-message");
    const modalYesBtn = document.getElementById("modal-yes-btn");
    const modalNoBtn = document.getElementById("modal-no-btn");
    const placaCarretaDropdownToggle = document.getElementById("placa-carreta-dropdown-toggle");
    const placaCarretaDropdownList = document.getElementById("placa-carreta-dropdown-list");
    const customDropdownContainer = document.querySelector(".custom-dropdown-container");
    const fkeyStatusElement = document.getElementById("fkey-status");

    // --- VARIÁVEIS DE ESTADO E CONFIGURAÇÃO ---
    let PLATE_WEIGHTS = {};
    let VALID_PLATES = [];
    let pendingWeighings = {};
    let currentWeight = 0;
    let weighingInterval;
    let animationInterval; // Intervalo para a animação de F8/F9
    const CONTRACTS = { "001": "TAMOIO", "002": "CHAPERÓ" };
    
    // --- VARIÁVEIS DE ESTADO DO FLUXO ---
    let orderedPlates = [];
    let isBalanceStable = false;
    let isWeighingProcessActive = false;
    let activeWeighingPlate = null;
    let fKeysActive = false;
    let isSimulationRunning = false; // Flag geral para animação de F8 ou F9

    // --- LÓGICA WEBSOCKET PARA CONTROLE REMOTO ---
    let socket;
    // IMPORTANTE: Substitua pela URL do seu servidor WebSocket hospedado no Render ou similar
    const WEBSOCKET_URL = 'wss://seu-servidor-aqui.onrender.com'; 

    /**
     * Inicia a conexão com o servidor WebSocket e configura os listeners.
     */
    function connectWebSocket() {
        // Usa wss:// para conexões seguras, que o Render fornece
        socket = new WebSocket(WEBSOCKET_URL);

        socket.onopen = () => {
            console.log('Conectado ao servidor WebSocket.');
            // Envia uma mensagem para se registrar como o cliente Electron
            socket.send(JSON.stringify({ type: 'register_electron' }));
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Mensagem recebida do servidor:', data);

                // Verifica se é um comando para executar vindo do controle remoto
                if (data.type === 'execute_command' && data.key) {
                    console.log(`Executando comando remoto: ${data.key}`);
                    // Simula o pressionamento de tecla para reutilizar a lógica existente
                    const fakeEvent = {
                        key: data.key,
                        preventDefault: () => {} // Função vazia para evitar erros
                    };
                    handleKeyPress(fakeEvent);
                }
            } catch (error) {
                console.error('Erro ao processar mensagem do WebSocket:', error);
            }
        };

        socket.onclose = () => {
            console.log('Desconectado do servidor WebSocket. Tentando reconectar em 5 segundos...');
            // Tenta reconectar após um tempo para manter a conexão ativa
            setTimeout(connectWebSocket, 5000);
        };

        socket.onerror = (error) => {
            console.error('Erro no WebSocket:', error);
            // O evento 'onclose' será chamado em seguida, tratando a reconexão.
        };
    }

    /**
     * Envia uma atualização de status para o(s) controle(s) remoto(s) conectado(s).
     * @param {string} status - A mensagem de status principal.
     * @param {object} details - Um objeto com detalhes adicionais (ex: peso, placa).
     */
    function sendStatusUpdate(status, details = {}) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'status_update',
                payload: {
                    status: status,
                    ...details
                }
            }));
        }
    }

    // --- FUNÇÕES AUXILIARES ---
    function getFormattedDateTime() {
        const now = new Date();
        const pad = (num) => String(num).padStart(2, "0");
        return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    function updateClock() { if (datetimeElement) datetimeElement.textContent = `Data/Hora: ${getFormattedDateTime()}`; }
    
    function showCustomModal(message, onYes, onNo = () => {}) {
        modalMessage.textContent = message;
        customModal.style.display = 'flex';
        modalYesBtn.onclick = () => { customModal.style.display = 'none'; onYes(); };
        modalNoBtn.onclick = () => { customModal.style.display = 'none'; onNo(); };
    }

    function updateWeightDisplay() {
        if (weightValue) weightValue.textContent = currentWeight;
    }

    function updateFKeyStatus() {
        if (!fkeyStatusElement) return;
        if (fKeysActive) {
            fkeyStatusElement.textContent = 'Online';
            fkeyStatusElement.style.color = 'lime';
        } else {
            fkeyStatusElement.textContent = 'Offline';
            fkeyStatusElement.style.color = 'red';
        }
    }

    function resetUI(clearPlate = true) {
        if(clearPlate) {
            placaCarretaInput.value = '';
            placaVeiculoInput.value = '';
        }
        contratoSelect.value = '';
        contratoDesc.value = '';
        transportadoraSelect.value = '';
        transportadoraDesc.value = '';
        currentWeight = 0;
        updateWeightDisplay();
        weighingStatus.textContent = "Aguardando Pesagem";
        sendStatusUpdate("Aguardando Pesagem", { currentWeight: 0 }); // Notifica o controle remoto

        toggleFields(true);
        btnConfirmWeighing.disabled = false;
        
        isBalanceStable = false;
        isWeighingProcessActive = false;
        activeWeighingPlate = null; 
        clearInterval(weighingInterval);
        clearInterval(animationInterval);
        isSimulationRunning = false;

        hideCustomDropdown();
    }
    
    function toggleFields(enabled) {
        contratoSelect.disabled = !enabled;
        transportadoraSelect.disabled = !enabled;
        emissorSelect.disabled = !enabled;
        itemSelect.disabled = !enabled;
    }

    function loadPlateData(plateData) {
        contratoSelect.value = plateData.contrato;
        contratoDesc.value = CONTRACTS[plateData.contrato];
        transportadoraDesc.value = plateData.transportadoraDesc;
        emissorDesc.value = plateData.emissorDesc;
        itemDesc.value = plateData.itemDesc;
        for(let option of transportadoraSelect.options){
            if(option.value === plateData.transportadoraDesc) {
                option.selected = true;
                break;
            }
        }
        toggleFields(false);
    }

    // --- FUNÇÕES DO DROPDOWN CUSTOMIZADO ---
    function populateCustomDropdown() {
        placaCarretaDropdownList.innerHTML = '';
        const platesToDisplay = Object.keys(pendingWeighings);
        if (platesToDisplay.length === 0) {
            const noOptions = document.createElement('div');
            noOptions.classList.add('dropdown-item', 'no-options');
            noOptions.textContent = 'Nenhuma placa pendente';
            placaCarretaDropdownList.appendChild(noOptions);
        } else {
            platesToDisplay.forEach(plate => {
                const item = document.createElement('div');
                item.classList.add('dropdown-item');
                item.textContent = plate;
                item.addEventListener('click', () => selectCustomDropdownItem(plate));
                placaCarretaDropdownList.appendChild(item);
            });
        }
    }

    function toggleCustomDropdown() {
        placaCarretaDropdownList.style.display = placaCarretaDropdownList.style.display === 'block' ? 'none' : 'block';
        if (placaCarretaDropdownList.style.display === 'block') {
            filterCustomDropdown();
        }
    }

    function hideCustomDropdown() {
        placaCarretaDropdownList.style.display = 'none';
    }

    function selectCustomDropdownItem(plate) {
        placaCarretaInput.value = plate;
        placaCarretaInput.dispatchEvent(new Event('change'));
        hideCustomDropdown();
    }

    function filterCustomDropdown() {
        const filter = placaCarretaInput.value.toUpperCase();
        const items = placaCarretaDropdownList.querySelectorAll('.dropdown-item');
        let hasVisibleItems = false;
        items.forEach(item => {
            if (item.classList.contains('no-options')) {
                item.style.display = 'none';
                return;
            }
            const textValue = item.textContent || item.innerText;
            if (textValue.toUpperCase().indexOf(filter) > -1) {
                item.style.display = '';
                hasVisibleItems = true;
            } else {
                item.style.display = 'none';
            }
        });

        let noResultsMessage = placaCarretaDropdownList.querySelector('.no-results');
        if (!hasVisibleItems && filter !== '') {
            if (!noResultsMessage) {
                noResultsMessage = document.createElement('div');
                noResultsMessage.classList.add('dropdown-item', 'no-results');
                noResultsMessage.textContent = 'Nenhum resultado encontrado';
                placaCarretaDropdownList.appendChild(noResultsMessage);
            }
            noResultsMessage.style.display = 'block';
        } else if (noResultsMessage) {
            noResultsMessage.style.display = 'none';
        }
    }


    // --- INICIALIZAÇÃO DO APLICATIVO ---
    async function initializeApp() {
        btnConfirmWeighing.disabled = true;

        const plateData = await ipcRenderer.invoke('get-plate-weights');
        PLATE_WEIGHTS = plateData.weights;
        orderedPlates = plateData.order; 
        VALID_PLATES = Object.keys(PLATE_WEIGHTS);

        if (VALID_PLATES.length === 0) {
            showCustomModal("Atenção: Nenhuma placa foi carregada. Verifique o arquivo 'placas.txt'.", () => {});
        } else {
            btnConfirmWeighing.disabled = false;
        }
        
        pendingWeighings = await ipcRenderer.invoke('load-weighings');
        if (Object.keys(pendingWeighings).length > 0) {
            showCustomModal(`Foram carregadas ${Object.keys(pendingWeighings).length} pesagens pendentes.`, () => {});
        }
        populateCustomDropdown();

        // Inicia a conexão WebSocket
        connectWebSocket();

        setupDropdowns();
        updateClock();
        setInterval(updateClock, 1000);
        document.addEventListener('keydown', handleKeyPress);

        placaCarretaDropdownToggle.addEventListener('click', toggleCustomDropdown);
        placaCarretaInput.addEventListener('focus', () => {
            populateCustomDropdown();
            toggleCustomDropdown();
        });
        placaCarretaInput.addEventListener('input', filterCustomDropdown);

        document.addEventListener('click', (event) => {
            if (!customDropdownContainer.contains(event.target) && placaCarretaDropdownList.style.display === 'block') {
                hideCustomDropdown();
            }
        });

        updateFKeyStatus();
    }

    function setupDropdowns() {
        contratoSelect.innerHTML = '<option value="">Selecione...</option>' + Object.keys(CONTRACTS).map(key => `<option value="${key}">${key}</option>`).join('');
        contratoSelect.value = '';
        contratoDesc.value = '';
        contratoSelect.addEventListener('change', () => {
            contratoDesc.value = CONTRACTS[contratoSelect.value] || '';
        });

        ipcRenderer.on('obras-data-reply', (event, obras) => {
            transportadoraSelect.innerHTML = '<option value="">Selecione...</option>';
            obras.forEach(obra => {
                const option = document.createElement('option');
                option.value = obra.description;
                option.textContent = obra.code;
                transportadoraSelect.appendChild(option);
            });
        });
        ipcRenderer.send('get-obras-data');

        transportadoraSelect.addEventListener('change', () => transportadoraDesc.value = transportadoraSelect.value);

        emissorSelect.innerHTML = `<option value="001 - CONSTRUTORA LYTORANEA - SAIDA">001</option>`;
        emissorDesc.value = "001 - CONSTRUTORA LYTORANEA - SAIDA";
        itemSelect.innerHTML = `<option value="2 - ASFALTO 5A">2</option>`;
        itemDesc.value = "2 - ASFALTO 5A";
    }
    
    placaCarretaInput.addEventListener('change', () => {
        const plate = placaCarretaInput.value.trim().toUpperCase();
        placaCarretaInput.value = plate;
        if (pendingWeighings[plate]) {
            placaVeiculoInput.value = plate;
            if (!isWeighingProcessActive) {
                weighingStatus.textContent = 'Aguardando Pesagem';
                sendStatusUpdate("Aguardando Pesagem", { currentWeight: 0 });
            }
            loadPlateData(pendingWeighings[plate]);
        } else {
            placaVeiculoInput.value = '';
            if (!isWeighingProcessActive) {
                weighingStatus.textContent = 'Aguardando Pesagem';
                sendStatusUpdate("Aguardando Pesagem", { currentWeight: 0 });
                resetUI(false);
            }
        }
    });

    function animateWeight(target, onComplete, duration = 2000, startWeight = 0) {
        clearInterval(weighingInterval);
        let tempWeight = startWeight;
        const weightDifference = target - startWeight;

        if (weightDifference <= 0) {
            currentWeight = target;
            updateWeightDisplay();
            if (onComplete) onComplete();
            return;
        }
        
        const fps = 7;
        const intervalTime = 1000 / fps;
        const increment = weightDifference / (duration / intervalTime);

        weighingInterval = setInterval(() => {
            tempWeight += increment;
            currentWeight = Math.round(tempWeight / 10) * 10;
            updateWeightDisplay();
            sendStatusUpdate("Pesando...", { currentWeight: currentWeight }); // Envia status durante a animação

            if (tempWeight >= target) {
                currentWeight = target;
                updateWeightDisplay();
                clearInterval(weighingInterval);
                if (onComplete) onComplete();
            }
        }, intervalTime);
    }

    // --- LÓGICA DE ANIMAÇÃO PARA F8 / F9 ---
    function handleSimulationAnimation(maxValue) {
        isSimulationRunning = true;
        weighingStatus.textContent = "Aguardando posicionamento";
        sendStatusUpdate("Simulação: Aguardando posicionamento");
        btnConfirmWeighing.disabled = true;

        const riseTime = 4000; // 4 segundos
        const varyTime = 3000; // 3 segundos
        const fallTime = 3000; // 3 segundos
        
        // 1. Subir até o valor máximo
        let startTime = Date.now();
        animationInterval = setInterval(() => {
            const elapsedTime = Date.now() - startTime;
            if (elapsedTime >= riseTime) {
                currentWeight = maxValue;
                updateWeightDisplay();
                clearInterval(animationInterval);
                startVaryingPhase();
                return;
            }
            const progress = elapsedTime / riseTime;
            currentWeight = Math.round(progress * maxValue);
            updateWeightDisplay();
        }, 1000 / 7); // ~7fps

        // 2. Variar o valor
        function startVaryingPhase() {
            let varyStartTime = Date.now();
            animationInterval = setInterval(() => {
                const elapsedTime = Date.now() - varyStartTime;
                if (elapsedTime >= varyTime) {
                    clearInterval(animationInterval);
                    startFallingPhase();
                    return;
                }
                // Varia entre -10 e +10
                const variation = Math.floor(Math.random() * 21) - 10;
                currentWeight = maxValue + variation;
                updateWeightDisplay();
            }, 150); // Varia a cada 150ms
        }

        // 3. Descer até zero
        function startFallingPhase() {
            const startFallWeight = currentWeight; // Começa do último peso variado
            let fallStartTime = Date.now();
            animationInterval = setInterval(() => {
                const elapsedTime = Date.now() - fallStartTime;
                if (elapsedTime >= fallTime) {
                    currentWeight = 0;
                    updateWeightDisplay();
                    clearInterval(animationInterval);
                    weighingStatus.textContent = "Aguardando Pesagem";
                    sendStatusUpdate("Simulação finalizada. Aguardando Pesagem");
                    btnConfirmWeighing.disabled = false;
                    isSimulationRunning = false; // Reseta a flag
                    return;
                }
                const progress = elapsedTime / fallTime;
                currentWeight = Math.round(startFallWeight * (1 - progress));
                updateWeightDisplay();
            }, 1000 / 7); // ~7fps
        }
    }


    // --- LÓGICA DE PESAGEM ---

    function startFirstWeighing(placaCarreta) {
        showCustomModal(`Confirmar 1ª pesagem para ${placaCarreta}?`, () => {
            weighingStatus.textContent = "Pesando...";
            sendStatusUpdate("Pesando...", { placa: placaCarreta });
            btnConfirmWeighing.disabled = true;
            animateWeight(PLATE_WEIGHTS[placaCarreta].initial, () => {
                weighingStatus.textContent = "Pesagem Concluída!";
                sendStatusUpdate("1ª Pesagem Concluída", { placa: placaCarreta, peso: currentWeight });
                btnConfirmWeighing.disabled = false;
                pendingWeighings[placaCarreta] = {
                    pesoInicial: currentWeight, dataInicio: getFormattedDateTime(),
                    contrato: contratoSelect.value, transportadoraDesc: transportadoraDesc.value,
                    emissorDesc: emissorDesc.value, itemDesc: itemDesc.value
                };
                ipcRenderer.send('save-weighings', pendingWeighings);
                populateCustomDropdown();
                showCustomModal(`1ª Pesagem de ${currentWeight}kg registrada para ${placaCarreta}.`, () => resetUI(true));
            }, 2000);
        });
    }

    function finishSecondWeighing(placaCarreta) {
        showCustomModal(`Confirmar 2ª pesagem e gerar ticket para ${placaCarreta}?`, () => {
            btnConfirmWeighing.disabled = true;

            const generateTicketAndFinalize = () => {
                const finalData = { 
                    ...pendingWeighings[placaCarreta], 
                    placa: placaCarreta,
                    placaCarreta: placaCarretaInput.value.trim().toUpperCase(),
                    placaVeiculo: placaVeiculoInput.value.trim().toUpperCase(),
                    pesoFinal: currentWeight, 
                    dataFinal: getFormattedDateTime()
                };
                sendStatusUpdate("Ticket Gerado", { placa: placaCarreta });
                ipcRenderer.send('show-ticket', finalData);
                delete pendingWeighings[placaCarreta];
                ipcRenderer.send('save-weighings', pendingWeighings);
                populateCustomDropdown();
                showCustomModal("Processo concluído. O comprovante será exibido.", () => resetUI(true));
            };
            
            generateTicketAndFinalize();
        });
    }

    // --- FLUXOS DE 2ª PESAGEM ---
    function startSecondWeighingProcess(plate) {
        if (isWeighingProcessActive || isSimulationRunning) return;

        isWeighingProcessActive = true;
        activeWeighingPlate = plate; 
        weighingStatus.textContent = "Aguardando posicionamento";
        sendStatusUpdate("Aguardando 2ª pesagem", { placa: plate });
        btnConfirmWeighing.disabled = true;
        currentWeight = 0;
        updateWeightDisplay();

        const finalWeight = PLATE_WEIGHTS[plate].final;
        
        // 1. Anima o peso até o valor final
        animateWeight(finalWeight, () => {
            weighingStatus.textContent = "Aguardando posicionamento";
            
            // 2. Varia o peso por 3 segundos
            animationInterval = setInterval(() => {
                const variation = Math.floor(Math.random() * 21) - 10; // -10 a +10
                currentWeight = finalWeight + variation;
                updateWeightDisplay();
            }, 150);

            // 3. Após 3 segundos, finaliza a pesagem
            setTimeout(() => {
                clearInterval(animationInterval);
                currentWeight = finalWeight; // Garante o peso final exato
                updateWeightDisplay();
                weighingStatus.textContent = "Balança estabilizada";
                sendStatusUpdate("Balança estabilizada", { placa: plate, peso: currentWeight });
                isBalanceStable = true;
                btnConfirmWeighing.disabled = false;
                isWeighingProcessActive = false;
            }, 3000); // 3 segundos de variação

        }, 10000);
    }


    // --- LISTENERS DE EVENTOS ---
    btnConfirmWeighing.addEventListener("click", () => {
        const placaCarreta = placaCarretaInput.value.trim().toUpperCase();
        if (!placaCarreta) return;

        if (isSimulationRunning) return; // Bloqueia clique durante a animação F8/F9

        // Lógica para 1ª Pesagem
        if (!pendingWeighings[placaCarreta] && !isWeighingProcessActive) {
            if (!VALID_PLATES.includes(placaCarreta) || placaCarreta !== placaVeiculoInput.value.trim().toUpperCase()) {
                return showCustomModal("Placa inválida ou as placas não são iguais. Verifique os dados.", () => {});
            }
            if (!transportadoraSelect.value || !contratoSelect.value) {
                return showCustomModal("Por favor, selecione Transportadora/Obra e Contrato.", () => {});
            }
            startFirstWeighing(placaCarreta);
            return;
        }

        // Lógica para 2ª Pesagem
        if (pendingWeighings[placaCarreta] || activeWeighingPlate) {
            if (isBalanceStable) {
                if (placaCarreta !== activeWeighingPlate) {
                    return showCustomModal("Placa inválida ou as placas não são iguais. Verifique os dados.", () => {});
                }
                finishSecondWeighing(placaCarreta);
            } else if (!isWeighingProcessActive) {
                startSecondWeighingProcess(placaCarreta);
            }
        }
    });
    
    function handleKeyPress(event) {
        // Se uma simulação (F8/F9) está rodando, bloqueia QUALQUER outra tecla F.
        if (isSimulationRunning) {
             if (event.key.startsWith('F')) {
                event.preventDefault();
                return;
             }
        }

        // Trava para F10
        if (event.key === 'F10') {
            event.preventDefault();
            fKeysActive = !fKeysActive;
            updateFKeyStatus();
            return;
        }
        
        // Lógica para F8
        if (event.key === 'F8') {
            event.preventDefault();
            if (!fKeysActive || isWeighingProcessActive) return;
            handleSimulationAnimation(14390);
            return;
        }
        
        // Lógica para F9
        if (event.key === 'F9') {
            event.preventDefault();
            if (!fKeysActive || isWeighingProcessActive) return;
            handleSimulationAnimation(8740);
            return;
        }

        if (event.key.startsWith('F')) {
            const keyIndex = parseInt(event.key.substring(1), 10) - 1;

            // Lógica para F1-F6
            if (keyIndex >= 0 && keyIndex < 6) {
                event.preventDefault();

                if (!fKeysActive) return;

                const fKeyPlate = orderedPlates[keyIndex];
                if (!fKeyPlate || isWeighingProcessActive || !pendingWeighings[fKeyPlate]) {
                    return; 
                }

                const typedPlate = placaCarretaInput.value.trim().toUpperCase();
                
                if (typedPlate && typedPlate !== fKeyPlate) {
                    showCustomModal("Erro: Falha (Código: 0x80070057)", () => {});
                    return;
                }
                
                resetUI(true);
                startSecondWeighingProcess(fKeyPlate);
            }
        }
    }

    initializeApp();
});
