// DOM Elements
const analysisTab = document.getElementById('analysis-tab');
const insertionTab = document.getElementById('insertion-tab');
const backupTab = document.getElementById('backup-tab');

const analysisSection = document.getElementById('analysis-section');
const insertionSection = document.getElementById('insertion-section');
const backupSection = document.getElementById('backup-section');

const analysisForm = document.getElementById('analysis-form');
const insertionForm = document.getElementById('insertion-form');

const analyzeButton = document.getElementById('analyze-button');
const insertButton = document.getElementById('insert-button');
const removeButton = document.getElementById('remove-button');
const listBackupsButton = document.getElementById('list-backups-button');

const analysisResults = document.getElementById('analysis-results');
const insertionResults = document.getElementById('insertion-results');
const backupResults = document.getElementById('backup-results');
const restoreResults = document.getElementById('restore-results');

const loading = document.getElementById('loading');

// Chart instances
let similarityChart = null;
let topNotesChart = null;
let categoryChart = null;

// Tab Switching
function switchTab(tabName) {
    // Hide all sections
    analysisSection.classList.remove('active');
    insertionSection.classList.remove('active');
    backupSection.classList.remove('active');
    
    // Remove active class from all tabs
    analysisTab.classList.remove('active');
    insertionTab.classList.remove('active');
    backupTab.classList.remove('active');
    
    // Show selected section and activate tab
    if (tabName === 'analysis') {
        analysisSection.classList.add('active');
        analysisTab.classList.add('active');
    } else if (tabName === 'insertion') {
        insertionSection.classList.add('active');
        insertionTab.classList.add('active');
    } else if (tabName === 'backup') {
        backupSection.classList.add('active');
        backupTab.classList.add('active');
    }
}

// Event Listeners for Tab Switching
analysisTab.addEventListener('click', () => switchTab('analysis'));
insertionTab.addEventListener('click', () => switchTab('insertion'));
backupTab.addEventListener('click', () => switchTab('backup'));

// API Functions
async function callAPI(endpoint, data, method = 'POST') {
    showLoading();
    
    try {
        const response = await fetch(`/api${endpoint}`, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        hideLoading();
        
        if (!response.ok) {
            throw new Error(result.error || 'API request failed');
        }
        
        return result;
    } catch (error) {
        hideLoading();
        throw error;
    }
}

// Analysis Functions
analysisForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = {
        vaultPath: document.getElementById('vault-path').value,
        threshold: parseFloat(document.getElementById('similarity-threshold').value),
        maxLinks: parseInt(document.getElementById('max-links').value),
        adjustLowLinks: document.getElementById('adjust-low-links').checked,
        incremental: document.getElementById('incremental-analysis').checked,
        clearCache: document.getElementById('clear-cache').checked,
        dryRun: document.getElementById('dry-run').checked
    };
    
    try {
        const result = await callAPI('/analyze', formData);
        displayAnalysisResults(result);
        renderCharts(result.results);
        renderTopLinks(result.results);
    } catch (error) {
        displayError('analysis-output', error.message);
    }
});

function displayAnalysisResults(result) {
    const output = document.getElementById('analysis-output');
    
    if (result.success) {
        output.innerHTML = `
            <p><strong>Status:</strong> ${result.message}</p>
            <p><strong>Processed Notes:</strong> ${result.results.metadata.processedNotes}</p>
            <p><strong>Total Links Found:</strong> ${result.results.metadata.totalLinks}</p>
            <p><strong>Similarity Threshold:</strong> ${result.results.metadata.similarityThreshold}</p>
            <p><strong>Max Links Per Note:</strong> ${result.results.metadata.maxLinksPerNote}</p>
            <p><strong>Analysis Timestamp:</strong> ${result.results.metadata.timestamp}</p>
        `;
    } else {
        output.innerHTML = `<p><strong>Error:</strong> ${result.error}</p>`;
    }
    
    analysisResults.style.display = 'block';
}

function renderCharts(results) {
    const chartsContainer = document.getElementById('charts-container');
    
    if (!results || !results.links || results.links.length === 0) {
        chartsContainer.style.display = 'none';
        return;
    }
    
    // Prepare data for charts
    const links = results.links;
    
    // Similarity distribution data
    const similarityBins = Array(10).fill(0);
    links.forEach(link => {
        const binIndex = Math.min(9, Math.floor(link.similarity * 10));
        similarityBins[binIndex]++;
    });
    
    // Top notes by link count
    const noteLinkCount = {};
    links.forEach(link => {
        noteLinkCount[link.source] = (noteLinkCount[link.source] || 0) + 1;
        noteLinkCount[link.target] = (noteLinkCount[link.target] || 0) + 1;
    });
    
    const sortedNotes = Object.entries(noteLinkCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    
    // Category distribution
    const categoryCount = {};
    links.forEach(link => {
        const category = link.category || 'Uncategorized';
        categoryCount[category] = (categoryCount[category] || 0) + 1;
    });
    
    // Destroy existing charts if they exist
    if (similarityChart) similarityChart.destroy();
    if (topNotesChart) topNotesChart.destroy();
    if (categoryChart) categoryChart.destroy();
    
    // Create similarity chart
    const similarityCtx = document.getElementById('similarity-chart').getContext('2d');
    similarityChart = new Chart(similarityCtx, {
        type: 'bar',
        data: {
            labels: ['0.0-0.1', '0.1-0.2', '0.2-0.3', '0.3-0.4', '0.4-0.5', '0.5-0.6', '0.6-0.7', '0.7-0.8', '0.8-0.9', '0.9-1.0'],
            datasets: [{
                label: 'Number of Links',
                data: similarityBins,
                backgroundColor: 'rgba(52, 152, 219, 0.7)',
                borderColor: 'rgba(52, 152, 219, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Number of Links'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Similarity Range'
                    }
                }
            }
        }
    });
    
    // Create top notes chart
    const topNotesCtx = document.getElementById('top-notes-chart').getContext('2d');
    topNotesChart = new Chart(topNotesCtx, {
        type: 'bar',
        data: {
            labels: sortedNotes.map(item => item[0]),
            datasets: [{
                label: 'Link Count',
                data: sortedNotes.map(item => item[1]),
                backgroundColor: 'rgba(46, 204, 113, 0.7)',
                borderColor: 'rgba(46, 204, 113, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Number of Links'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Notes'
                    }
                }
            }
        }
    });
    
    // Create category chart
    const categoryCtx = document.getElementById('category-chart').getContext('2d');
    categoryChart = new Chart(categoryCtx, {
        type: 'pie',
        data: {
            labels: Object.keys(categoryCount),
            datasets: [{
                data: Object.values(categoryCount),
                backgroundColor: [
                    'rgba(52, 152, 219, 0.7)',
                    'rgba(46, 204, 113, 0.7)',
                    'rgba(155, 89, 182, 0.7)',
                    'rgba(241, 196, 15, 0.7)',
                    'rgba(230, 126, 34, 0.7)',
                    'rgba(231, 76, 60, 0.7)',
                    'rgba(149, 165, 166, 0.7)',
                    'rgba(52, 73, 94, 0.7)'
                ],
                borderColor: [
                    'rgba(52, 152, 219, 1)',
                    'rgba(46, 204, 113, 1)',
                    'rgba(155, 89, 182, 1)',
                    'rgba(241, 196, 15, 1)',
                    'rgba(230, 126, 34, 1)',
                    'rgba(231, 76, 60, 1)',
                    'rgba(149, 165, 166, 1)',
                    'rgba(52, 73, 94, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'top',
                },
                title: {
                    display: true,
                    text: 'Links by Category'
                }
            }
        }
    });
    
    chartsContainer.style.display = 'block';
}

function renderTopLinks(results) {
    const topLinksContainer = document.getElementById('top-links-container');
    const tableBody = document.querySelector('#top-links-table tbody');
    
    if (!results || !results.links || results.links.length === 0) {
        topLinksContainer.style.display = 'none';
        return;
    }
    
    // Sort links by similarity and take top 20
    const topLinks = [...results.links]
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 20);
    
    // Clear existing table content
    tableBody.innerHTML = '';
    
    // Populate table with top links
    topLinks.forEach(link => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${link.source}</td>
            <td>${link.target}</td>
            <td>${link.similarity.toFixed(3)}</td>
            <td>${link.category || 'Uncategorized'}</td>
        `;
        tableBody.appendChild(row);
    });
    
    topLinksContainer.style.display = 'block';
}

// Insertion Functions
insertionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (document.getElementById('remove-links').checked) {
        await removeLinks();
        return;
    }
    
    const formData = {
        inputPath: document.getElementById('input-path').value,
        sectionTitle: document.getElementById('section-title').value,
        groupBy: document.getElementById('group-by').value,
        limit: document.getElementById('link-limit').value ? parseInt(document.getElementById('link-limit').value) : undefined
    };
    
    try {
        const result = await callAPI('/insert', formData);
        displayInsertionResults(result);
    } catch (error) {
        displayError('insertion-output', error.message);
    }
});

document.getElementById('remove-button').addEventListener('click', removeLinks);

async function removeLinks() {
    const formData = {
        inputPath: document.getElementById('input-path').value
    };
    
    try {
        const result = await callAPI('/remove', formData);
        displayInsertionResults(result);
    } catch (error) {
        displayError('insertion-output', error.message);
    }
}

function displayInsertionResults(result) {
    const output = document.getElementById('insertion-output');
    
    if (result.success) {
        output.innerHTML = `<p><strong>Success:</strong> ${result.message}</p>`;
    } else {
        output.innerHTML = `<p><strong>Error:</strong> ${result.error}</p>`;
    }
    
    insertionResults.style.display = 'block';
}

// Backup Functions
listBackupsButton.addEventListener('click', listBackups);

async function listBackups() {
    try {
        const result = await callAPI('/backups/list', {}, 'GET');
        displayBackups(result.backups);
    } catch (error) {
        displayError('backup-output', error.message);
    }
}

function displayBackups(backups) {
    const output = document.getElementById('backup-output');
    
    if (backups.length === 0) {
        output.innerHTML = '<p>No backups found.</p>';
    } else {
        let html = `
            <table class="backup-list">
                <thead>
                    <tr>
                        <th>Backup ID</th>
                        <th>Created At</th>
                        <th>File Count</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        backups.forEach(backup => {
            html += `
                <tr>
                    <td>${backup.id}</td>
                    <td>${new Date(backup.createdAt).toLocaleString()}</td>
                    <td>${backup.fileCount}</td>
                    <td>
                        <button class="restore-button" onclick="restoreBackup('${backup.id}')">Restore</button>
                        <button class="delete-button" onclick="deleteBackup('${backup.id}')">Delete</button>
                    </td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
        
        output.innerHTML = html;
    }
    
    backupResults.style.display = 'block';
}

async function restoreBackup(backupId) {
    try {
        const result = await callAPI('/backups/restore', { backupId });
        displayRestoreResults(result);
    } catch (error) {
        displayError('restore-output', error.message);
    }
}

async function deleteBackup(backupId) {
    if (!confirm(`Are you sure you want to delete backup ${backupId}?`)) {
        return;
    }
    
    try {
        const result = await callAPI(`/backups/${backupId}`, {}, 'DELETE');
        displayRestoreResults(result);
        // Refresh the backup list
        listBackups();
    } catch (error) {
        displayError('restore-output', error.message);
    }
}

function displayRestoreResults(result) {
    const output = document.getElementById('restore-output');
    
    if (result.success) {
        output.innerHTML = `<p><strong>Success:</strong> ${result.message}</p>`;
    } else {
        output.innerHTML = `<p><strong>Error:</strong> ${result.error}</p>`;
    }
    
    restoreResults.style.display = 'block';
}

// Utility Functions
function showLoading() {
    loading.style.display = 'flex';
}

function hideLoading() {
    loading.style.display = 'none';
}

function displayError(elementId, message) {
    const element = document.getElementById(elementId);
    element.innerHTML = `<p><strong>Error:</strong> ${message}</p>`;
    
    // Find the parent results container and show it
    let parent = element.parentElement;
    while (parent && !parent.classList.contains('results')) {
        parent = parent.parentElement;
    }
    
    if (parent) {
        parent.style.display = 'block';
    }
}

// Make functions available globally for inline event handlers
window.restoreBackup = restoreBackup;
window.deleteBackup = deleteBackup;

// Initialize
switchTab('analysis');