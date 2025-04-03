// Punch Press Inspection System
const { jsPDF } = window.jspdf;
let inspections = [];
let previousInspections = [];
let selectedCards = new Set();
let currentDataSource = null;
let notificationTimeouts = {};
let autoUpdateInterval = null;
let changeDetectionEnabled = true;
const debugMode = false;

// DOM Elements
const elements = {
    cardContainer: document.getElementById('card-container'),
    welcomeMessage: document.querySelector('.welcome-message'),
    connectDataSourceBtn: document.getElementById('connect-data-source'),
    updateDataBtn: document.getElementById('update-data'),
    updateText: document.getElementById('update-text'),
    getStartedBtn: document.getElementById('get-started'),
    dataSourceModal: document.getElementById('data-source-modal'),
    closeDataSourceModal: document.getElementById('close-data-source-modal'),
    dataSourceStatus: document.getElementById('data-source-status'),
    sourceTypeSpan: document.getElementById('source-type'),
    sheetUrlInput: document.getElementById('sheet-url'),
    connectSheetBtn: document.getElementById('connect-sheet'),
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    statusFilter: document.getElementById('status-filter'),
    searchInput: document.getElementById('search'),
    bulkActions: document.getElementById('bulk-actions'),
    exportPdfBtn: document.getElementById('export-pdf'),
    formSelectedBtn: document.getElementById('form-selected'),
    notifySelectedBtn: document.getElementById('notify-selected'),
    stopNotifyBtn: document.getElementById('stop-notify'),
    selectAllBtn: document.getElementById('select-all'),
    deselectAllBtn: document.getElementById('deselect-all')
};

// Initialize the application
function init() {
    loadSavedDataSource();
    setupEventListeners();
    renderCards();
    startAutoUpdate();
}

function checkTimestampForBlinking() {
    const now = new Date();
    const oneHourInMs = 60 * 60 * 1000;

    inspections.forEach(inspection => {
        const lastUpdated = new Date(inspection.basicInfo.timestamp);
        const timeDiff = now - lastUpdated;
        inspection.notified = timeDiff > oneHourInMs;
    });

    renderCards();
}

function startAutoUpdate() {
    if (autoUpdateInterval) clearInterval(autoUpdateInterval);
    
    if (currentDataSource) {
        updateData().then(() => {
            checkTimestampForBlinking();
        });
    }
    
    autoUpdateInterval = setInterval(() => {
        if (currentDataSource) {
            elements.updateText.textContent = 'Updating...';
            updateData().then(() => {
                checkTimestampForBlinking();
                setTimeout(() => {
                    elements.updateText.textContent = 'Update';
                }, 2000);
            });
        }
    }, 5 * 60 * 1000);
}

function loadSavedDataSource() {
    try {
        const savedDataSource = localStorage.getItem('dataSource');
        if (!savedDataSource || savedDataSource !== 'google-sheets') return;
        
        currentDataSource = savedDataSource;
        
        const savedSheetUrl = localStorage.getItem('googleSheetUrl');
        if (savedSheetUrl) {
            elements.sheetUrlInput.value = savedSheetUrl;
            updateDataSourceStatus('Google Sheets', '#27ae60');
        }
    } catch (e) {
        console.error("LocalStorage access error:", e);
    }
}

function setupEventListeners() {
    elements.connectDataSourceBtn.addEventListener('click', showDataSourceModal);
    elements.updateDataBtn.addEventListener('click', () => {
        elements.updateText.textContent = 'Updating...';
        updateData().then(() => {
            checkTimestampForBlinking();
            setTimeout(() => {
                elements.updateText.textContent = 'Update';
            }, 2000);
        });
    });
    elements.getStartedBtn.addEventListener('click', showDataSourceModal);
    elements.closeDataSourceModal.addEventListener('click', hideDataSourceModal);
    
    elements.tabButtons.forEach(button => {
        button.addEventListener('click', () => switchTab(button.dataset.tab));
    });
    
    elements.connectSheetBtn.addEventListener('click', connectToGoogleSheets);
    elements.statusFilter.addEventListener('change', renderCards);
    elements.searchInput.addEventListener('input', debounce(renderCards, 300));
    
    elements.exportPdfBtn.addEventListener('click', exportSelectedToPDF);
    elements.formSelectedBtn.addEventListener('click', openSelectedForm);
    elements.notifySelectedBtn.addEventListener('click', notifySelectedCards);
    elements.stopNotifyBtn.addEventListener('click', stopNotifyingSelectedCards);
    elements.selectAllBtn.addEventListener('click', selectAllCards);
    elements.deselectAllBtn.addEventListener('click', deselectAllCards);
    
    window.addEventListener('click', (e) => {
        if (e.target === elements.dataSourceModal) hideDataSourceModal();
    });
}

function debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), timeout);
    };
}

function updateData() {
    return new Promise((resolve, reject) => {
        if (currentDataSource === 'google-sheets') {
            const sheetUrl = localStorage.getItem('googleSheetUrl');
            if (sheetUrl) {
                const sheetId = extractSheetId(sheetUrl);
                if (sheetId) {
                    loadDataFromGoogleSheets(sheetId)
                        .then(resolve)
                        .catch(reject);
                    return;
                }
            }
        }
        resolve();
    });
}

function showDataSourceModal() {
    elements.dataSourceModal.style.display = 'block';
}

function hideDataSourceModal() {
    elements.dataSourceModal.style.display = 'none';
}

function switchTab(tabId) {
    elements.tabButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    elements.tabContents.forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
}

function updateDataSourceStatus(sourceType, color = '#ccc') {
    elements.sourceTypeSpan.textContent = sourceType;
    elements.dataSourceStatus.querySelector('i').style.color = color;
}

async function connectToGoogleSheets() {
    const sheetUrl = elements.sheetUrlInput.value.trim();
    if (!sheetUrl) return alert('Please enter a Google Sheets URL');

    try {
        elements.connectSheetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
        elements.connectSheetBtn.disabled = true;
        
        const sheetId = extractSheetId(sheetUrl);
        if (!sheetId) throw new Error('Invalid Google Sheets URL format');
        
        await loadDataFromGoogleSheets(sheetId);
        
        localStorage.setItem('googleSheetUrl', sheetUrl);
        localStorage.setItem('dataSource', 'google-sheets');
        currentDataSource = 'google-sheets';
        
        updateDataSourceStatus('Google Sheets', '#27ae60');
        hideDataSourceModal();
        startAutoUpdate();
    } catch (error) {
        alert(`Failed to connect: ${error.message}`);
    } finally {
        elements.connectSheetBtn.innerHTML = '<i class="fas fa-link"></i> Connect Sheet';
        elements.connectSheetBtn.disabled = false;
    }
}

function extractSheetId(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

async function loadDataFromGoogleSheets(sheetId) {
    try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
            `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json`
        )}`;
        
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        const parsedData = JSON.parse(data.contents.substring(47).slice(0, -2));
        processSheetData(parsedData.table.rows);
    } catch (error) {
        throw new Error('Failed to load data. Please ensure the sheet is shared publicly.');
    }
}

function processSheetData(rows) {
    previousInspections = JSON.parse(JSON.stringify(inspections));
    const now = new Date();
    const oneHourInMs = 60 * 60 * 1000;
    
    inspections = rows.map((row, index) => {
        if (!row.c) return null;
        
        // Column mapping
        const status = (row.c[0]?.v || '').trim();        // Column A (0) - Status
        const pressNum = row.c[1]?.v?.toString().match(/\d+/)?.[0] || (index + 1);  // Column B (1) - Press Number
        const partNumber = row.c[2]?.v || '';             // Column C (2) - Part Name
        const link = row.c[3]?.v || '';                   // Column D (3) - Link
        const timestampValue = row.c[4]?.v;                // Column E (4) - Timestamp
        const color = row.c[5]?.v || '#3498db';           // Column F (5) - Color

        // Parse Google Sheets Date() format
        let timestamp = new Date(); // Default to current time
        
        if (timestampValue) {
            // Handle Google Sheets Date() format
            if (typeof timestampValue === 'string' && timestampValue.startsWith('Date(')) {
                const dateParts = timestampValue.match(/Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
                if (dateParts) {
                    // Note: Google Sheets months are 0-based (January=0)
                    timestamp = new Date(
                        parseInt(dateParts[1]), // year
                        parseInt(dateParts[2]), // month
                        parseInt(dateParts[3]), // day
                        parseInt(dateParts[4]), // hours
                        parseInt(dateParts[5]), // minutes
                        parseInt(dateParts[6])  // seconds
                    );
                }
            }
            // Fallback to standard date parsing
            else {
                timestamp = new Date(timestampValue);
            }
            
            if (isNaN(timestamp.getTime())) {
                console.warn(`Invalid date for press ${pressNum}, using current time`);
                timestamp = new Date();
            }
        }

        const timeDiff = now - timestamp;
        const shouldNotify = timeDiff > oneHourInMs;
        
        return {
            id: `press-${pressNum}-${Date.now()}`,
            basicInfo: {
                press: pressNum.toString(),
                partNumber,
                date: formatDate(timestamp),
                timestamp: timestamp.getTime()
            },
            inspection: {
                decision: {
                    status: getStandardizedStatus(status)
                }
            },
            link,
            design: { mainColor: color },
            notified: shouldNotify
        };
    }).filter(Boolean);
    
    detectAndNotifyChanges();
    renderCards();
}

function formatDate(dateValue) {
    try {
        if (!dateValue) return 'No date';
        
        const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
        
        if (isNaN(date.getTime())) {
            console.warn('Invalid date value:', dateValue);
            return 'Invalid date';
        }
        
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch (e) {
        console.error('Date formatting error:', e);
        return 'Invalid date';
    }
}

function formatDate(dateValue) {
    try {
        if (!dateValue) return 'No date';
        
        const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
        
        if (isNaN(date.getTime())) {
            console.warn('Invalid date value:', dateValue);
            return 'Invalid date';
        }
        
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch (e) {
        console.error('Date formatting error:', e);
        return 'Invalid date';
    }
}

function detectAndNotifyChanges() {
    if (!changeDetectionEnabled || previousInspections.length === 0) return;

    inspections.forEach(newInspection => {
        const oldInspection = previousInspections.find(i => i.id === newInspection.id);
        if (!oldInspection) return;
        
        if (newInspection.notified) {
            notifyCards([newInspection.id]);
        }
    });
}

function notifyCards(cardIds) {
    cardIds.forEach(cardId => {
        const inspection = inspections.find(i => i.id === cardId);
        if (inspection) {
            inspection.notified = true;
            clearTimeout(notificationTimeouts[cardId]);
            notificationTimeouts[cardId] = setTimeout(() => {
                stopNotification(cardId);
            }, 20 * 60 * 1000);
        }
    });
    
    renderCards();
}

function notifySelectedCards() {
    notifyCards(Array.from(selectedCards));
}

function stopNotifyingSelectedCards() {
    selectedCards.forEach(cardId => {
        stopNotification(cardId);
    });
    
    renderCards();
}

function stopNotification(cardId) {
    const inspection = inspections.find(i => i.id === cardId);
    if (inspection) {
        inspection.notified = false;
        clearTimeout(notificationTimeouts[cardId]);
        delete notificationTimeouts[cardId];
    }
}

function selectAllCards() {
    inspections.forEach(inspection => {
        selectedCards.add(inspection.id);
    });
    updateBulkActionsVisibility();
    renderCards();
}

function deselectAllCards() {
    selectedCards.clear();
    updateBulkActionsVisibility();
    renderCards();
}

function getStandardizedStatus(status) {
    const statusMap = {
        'accept': 'approved',
        'reject': 'rejected',
        'under watch': 'under-watch',
        'new': 'new',
        'ghost': 'ghost',
        'maintenance': 'maintenance'
    };
    
    const lowerStatus = status.toLowerCase();
    return statusMap[lowerStatus] || lowerStatus;
}

function renderCards() {
    elements.cardContainer.innerHTML = '';
    
    if (inspections.length === 0) {
        elements.welcomeMessage.style.display = 'flex';
        elements.bulkActions.style.display = 'none';
        return;
    }
    
    elements.welcomeMessage.style.display = 'none';
    
    const statusFilter = elements.statusFilter.value;
    const searchTerm = elements.searchInput.value.toLowerCase();
    
    inspections.forEach(inspection => {
        if (statusFilter !== 'all' && !inspection.inspection.decision.status.includes(statusFilter)) return;
        if (searchTerm && !inspection.basicInfo.press.toLowerCase().includes(searchTerm) && 
            !inspection.basicInfo.partNumber.toLowerCase().includes(searchTerm)) return;
        
        const card = document.createElement('div');
        const status = inspection.inspection.decision.status;
        const statusClass = `status-${status.replace(' ', '-')}`;
        const isSelected = selectedCards.has(inspection.id);
        
        card.className = `card ${statusClass} ${isSelected ? 'selected' : ''} ${inspection.notified ? 'notified' : ''}`;
        card.dataset.id = inspection.id;
        card.style.backgroundColor = inspection.design.mainColor;
        
        card.innerHTML = `
            <div class="card-header">
                <div class="card-title"> ${escapeHtml(inspection.basicInfo.press)}</div>
                <div class="status-icon">
                    <i class="fas ${getStatusIcon(status)}"></i>
                    <span>${status.replace('-', ' ').toUpperCase()}</span>
                </div>
            </div>
            <div class="card-body">
                <div class="card-detail">
                    <span><strong>Part:</strong> ${escapeHtml(inspection.basicInfo.partNumber)}</span>
                    <span><strong>Last Updated:</strong> ${formatDate(inspection.basicInfo.timestamp)}</span>
                </div>
            </div>
        `;
        
        card.addEventListener('click', (e) => {
            if (e.target.closest('.btn-form')) return;
            toggleCardSelection(inspection.id, card);
        });
        
        if (inspection.notified) {
            clearTimeout(notificationTimeouts[inspection.id]);
            notificationTimeouts[inspection.id] = setTimeout(() => {
                stopNotification(inspection.id);
            }, 20 * 60 * 1000);
        }
        
        elements.cardContainer.appendChild(card);
    });
    
    updateBulkActionsVisibility();
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getStatusIcon(status) {
    const statusMap = {
        'approved': 'fa-check-circle',
        'rejected': 'fa-times-circle',
        'under-watch': 'fa-eye',
        'new': 'fa-star',
        'ghost': 'fa-ghost',
        'maintenance': 'fa-tools'
    };
    return statusMap[status] || 'fa-question-circle';
}

function toggleCardSelection(cardId, cardElement) {
    if (selectedCards.has(cardId)) {
        selectedCards.delete(cardId);
        cardElement.classList.remove('selected');
    } else {
        selectedCards.add(cardId);
        cardElement.classList.add('selected');
    }
    updateBulkActionsVisibility();
}

function updateBulkActionsVisibility() {
    const hasSelection = selectedCards.size > 0;
    elements.bulkActions.style.display = hasSelection ? 'flex' : 'none';
    
    const selectedInspection = hasSelection && selectedCards.size === 1 ? 
        inspections.find(i => i.id === Array.from(selectedCards)[0]) : null;
    
    elements.formSelectedBtn.style.display = selectedInspection?.link ? 'block' : 'none';
    if (selectedInspection?.link) {
        elements.formSelectedBtn.onclick = () => window.open(selectedInspection.link, '_blank');
    }
}

function openSelectedForm() {
    if (selectedCards.size !== 1) return;
    
    const selectedId = Array.from(selectedCards)[0];
    const inspection = inspections.find(i => i.id === selectedId);
    
    if (inspection?.link) {
        window.open(inspection.link, '_blank');
    }
}

function exportSelectedToPDF() {
    if (selectedCards.size === 0 || typeof jsPDF === 'undefined') return;
    
    const doc = new jsPDF();
    let y = 20;
    
    doc.setFontSize(18);
    doc.setTextColor(40, 40, 40);
    doc.setFont('helvetica', 'bold');
    doc.text('PUNCH PRESS INSPECTION REPORT', 105, y, { align: 'center' });
    y += 15;
    
    inspections.filter(inspection => selectedCards.has(inspection.id))
        .forEach((inspection, index) => {
            if (index > 0 && y > 250) {
                doc.addPage();
                y = 20;
            }
            
            doc.setFontSize(14);
            doc.text(`Press: ${inspection.basicInfo.press}`, 20, y);
            y += 10;
            
            doc.text(`Part: ${inspection.basicInfo.partNumber}`, 20, y);
            y += 10;
            
            doc.text(`Last Updated: ${formatDate(inspection.basicInfo.timestamp)}`, 20, y);
            y += 10;
            
            doc.setTextColor(...getStatusColor(inspection.inspection.decision.status));
            doc.text(`Status: ${inspection.inspection.decision.status.toUpperCase()}`, 20, y);
            y += 15;
            
            if (index < selectedCards.size - 1) {
                doc.setTextColor(0, 0, 0);
                doc.line(20, y, 190, y);
                y += 15;
            }
        });
    
    doc.save(`Press_Inspections_${new Date().toISOString().split('T')[0]}.pdf`);
}

function getStatusColor(status) {
    const colors = {
        'approved': [39, 174, 96],
        'rejected': [231, 76, 60],
        'under-watch': [243, 156, 18],
        'new': [155, 89, 182],
        'ghost': [149, 165, 166],
        'maintenance': [52, 152, 219]
    };
    return colors[status] || [0, 0, 0];
}

// Initialize the app
document.addEventListener('DOMContentLoaded', init);