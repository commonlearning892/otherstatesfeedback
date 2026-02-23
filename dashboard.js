let RAW_DATA = null;
let CURRENT_BRANCH = '';
let CURRENT_STATE = '';
let CURRENT_CITY = '';
let CURRENT_ACADEMIC_CLASS = '';
let CURRENT_ACADEMIC_ORIENTATION = '';

// Debug: Log when script loads
console.log('🟢 Dashboard script loaded at:', new Date().toISOString());

fetch('feedback_stats.json?v=' + Date.now())
    .then(response => response.json())
    .then(data => {
        console.log('✅ JSON loaded successfully');
        console.log('📊 Subject performance keys:', Object.keys(data.subject_performance || {}));
        console.log('📊 Program excellence keys:', Object.keys(data.program_excellence || {}));
        console.log('📊 Total responses:', data.summary?.total_responses);
        RAW_DATA = data;
        renderDashboard(data);
    })
    .catch(error => {
        console.error('❌ Error loading JSON:', error);
        document.getElementById('content').innerHTML = '<h2>Error loading data</h2>';
    });

// Apply responsive Chart.js font sizes based on viewport
function applyResponsiveChartDefaults() {
    const w = window.innerWidth || 1024;
    let base = 12;
    if (w < 360) base = 9;
    else if (w < 480) base = 10;
    else if (w < 768) base = 11;
    else if (w > 1440) base = 14;
    if (window.Chart && Chart.defaults) {
        Chart.defaults.font = Chart.defaults.font || {};
        Chart.defaults.font.size = base;
        Chart.defaults.font.family = "'Inter', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif";
        Chart.defaults.plugins = Chart.defaults.plugins || {};
        Chart.defaults.plugins.legend = Chart.defaults.plugins.legend || {};
        Chart.defaults.plugins.legend.labels = Chart.defaults.plugins.legend.labels || {};
        Chart.defaults.plugins.legend.labels.font = Chart.defaults.plugins.legend.labels.font || {};
        Chart.defaults.plugins.legend.labels.font.size = base;
        Chart.defaults.scale = Chart.defaults.scale || {};
        Chart.defaults.scale.ticks = Chart.defaults.scale.ticks || {};
        Chart.defaults.scale.ticks.font = Chart.defaults.scale.ticks.font || {};
        Chart.defaults.scale.ticks.font.size = Math.max(9, base - 1);
    }
}

let __resizeTimer = null;
window.addEventListener('resize', () => {
    if (__resizeTimer) clearTimeout(__resizeTimer);
    __resizeTimer = setTimeout(() => {
        applyResponsiveChartDefaults();
        const view = deriveViewData(RAW_DATA, CURRENT_BRANCH);
        renderAllSections(view);
        renderComparison(view);
        sanitizeDisplayedText();
    }, 250);
});

// Build a branch-specific or state-specific data view from the global dataset
function deriveViewData(data, branch) {
    // If State is selected but no City, return state-level data
    if (!branch && CURRENT_STATE) {
        const stateName = CURRENT_STATE;
        const sp = data.state_performance?.[stateName];
        if (!sp) return data;
        
        return {
            summary: {
                total_responses: sp.count || 0,
                overall_avg: sp.overall_avg ?? null,
                category_scores: {
                    'Academics': sp.subject_avg ?? null,
                    'Environment': sp.environment_avg ?? null,
                    'Infrastructure': sp.infrastructure_avg ?? null,
                    'Administration': sp.admin_avg ?? null,
                }
            },
            overall_rating_counts: data.overall_rating_counts_by_state?.[stateName] || data.overall_rating_counts || {},
            recommendation: { distribution: {}, yes_pct: null },
            recommendation_reasons: {},
            subject_performance: data.state_subject_performance?.[stateName] || {},
            category_performance: data.state_category_performance?.[stateName] || {},
            program_excellence: data.program_excellence || {},
            communication_metrics: data.communication_metrics || {},
            communication_metrics_detail: data.communication_metrics_detail || {},
            concern_roles: {},
            concern_resolution: {},
            rankings: data.rankings,
            branch_subject_performance_by: data.state_subject_performance_by?.[stateName] || {},
            state_subject_performance_by: data.state_subject_performance_by || {},
            subject_performance_by: data.subject_performance_by || {},
            summary_all: data.summary
        };
    }
    
    // If no branch/city selected, return full data
    if (!branch) return data;
    
    const bp = data.branch_performance?.[branch];
    if (!bp) return data;
    const recCounts = (data.branch_recommendation_counts?.[branch]) || {};
    const yes = recCounts['Yes'] || 0, no = recCounts['No'] || 0, maybe = recCounts['Maybe'] || 0;
    const totalRec = yes + no + maybe;
    const yesPct = totalRec > 0 ? (yes / totalRec * 100.0) : null;
    let recReasons = null;
    try {
        const bySeg = data.branch_segment_recommendation_reasons?.[branch] || {};
        const aggKind = (kind) => {
            const counts = {};
            let total = 0;
            for (const seg of Object.keys(bySeg)) {
                const obj = bySeg[seg]?.[kind] || {};
                const arr = Array.isArray(obj.top_detail) ? obj.top_detail : [];
                for (const it of arr) {
                    const label = Array.isArray(it) ? it[0] : null;
                    const c = Array.isArray(it) ? (Number(it[1])||0) : 0;
                    if (!label) continue;
                    counts[label] = (counts[label]||0) + c;
                    total += c;
                }
            }
            const sorted = Object.entries(counts).sort((a,b)=> b[1]-a[1]).slice(0,10);
            const top_detail = sorted.map(([l,c])=> [l, c, total? Math.round(c*1000/total)/10 : 0]);
            const top = top_detail.map(([l,,p])=> [l, p]);
            return { total_reasons: total, top, top_detail };
        };
        const yesAgg = aggKind('Yes');
        const noAgg = aggKind('No');
        recReasons = { Yes: yesAgg, No: noAgg };
    } catch(_) {}
    let categoryPerf = data.branch_category_performance?.[branch] || {};
    try {
        const hasAny = categoryPerf && Object.keys(categoryPerf).length;
        const brCounts = data.branch_rating_counts?.[branch] || null;
        if (!hasAny && brCounts) {
            const makeItem = (label, counts) => {
                const exc = counts?.Excellent || 0;
                const good = counts?.Good || 0;
                const avg = counts?.Average || 0;
                const poor = counts?.Poor || 0;
                const denom = exc + good + avg + poor;
                const average = denom ? ((5 * exc + 4 * good + 3 * avg + 1 * poor) / denom) : null;
                return { average, rating_distribution: { Excellent: exc, Good: good, Average: avg, Poor: poor } };
            };
            categoryPerf = {
                'Environment Quality': { 'Environment': makeItem('Environment', brCounts.Environment) },
                'Infrastructure': { 'Infrastructure': makeItem('Infrastructure', brCounts.Infrastructure) },
                'Parent-Teacher Interaction': { 'Parent-Teacher': makeItem('Parent-Teacher', brCounts['Parent-Teacher']) },
                'Administrative Support': { 'Administrative Support': makeItem('Administrative Support', brCounts['Administrative Support']) }
            };
        }
    } catch (_) {}

    return {
        summary: {
            total_responses: bp.count || 0,
            overall_avg: bp.overall_avg ?? null,
            category_scores: {
                'Academics': bp.subject_avg ?? null,
                'Environment': bp.environment_avg ?? null,
                'Infrastructure': bp.infrastructure_avg ?? null,
                'Administration': bp.admin_avg ?? null,
            }
        },
        overall_rating_counts: (data.overall_rating_counts_by_branch?.[branch]) || data.overall_rating_counts || {},
        recommendation: { distribution: recCounts, yes_pct: yesPct },
        recommendation_reasons: recReasons || data.recommendation_reasons || {},
        subject_performance: data.branch_subject_performance?.[branch] || {},
        category_performance: categoryPerf,
        teaching_indicators: data.teaching_indicators_by_branch?.[branch] || data.teaching_indicators || {},
        ptm_effectiveness: data.ptm_effectiveness_by_branch?.[branch] ?? data.ptm_effectiveness ?? null,
        communication_metrics: data.communication_metrics_by_branch?.[branch] || data.communication_metrics || {},
        communication_metrics_detail: data.communication_metrics_detail_by_branch?.[branch] || data.communication_metrics_detail || {},
        environment_focus: data.environment_focus_by_branch?.[branch] || data.environment_focus || {},
        concern_roles: data.concern_roles_by_branch?.[branch] || data.concern_roles || {},
        concern_resolution: data.branch_concern_resolution?.[branch] || data.concern_resolution || {},
        program_excellence: data.program_excellence_by_branch?.[branch] || data.program_excellence || {},
        // Keep rankings global. Scope branch_* maps to the selected branch only.
        rankings: data.rankings,
        branch_performance: (data.branch_performance && data.branch_performance[branch]) ? { [branch]: data.branch_performance[branch] } : {},
        branch_recommendation_pct: (data.branch_recommendation_pct && data.branch_recommendation_pct[branch] != null) ? { [branch]: data.branch_recommendation_pct[branch] } : {},
        branch_recommendation_counts: (data.branch_recommendation_counts && data.branch_recommendation_counts[branch]) ? { [branch]: data.branch_recommendation_counts[branch] } : {},
        branch_rating_counts: (data.branch_rating_counts && data.branch_rating_counts[branch]) ? { [branch]: data.branch_rating_counts[branch] } : {},
        branch_recommendation_counts_by: (() => {
            const out = { class: {}, orientation: {}, pair: {} };
            try {
                const by = data.branch_recommendation_counts_by || {};
                out.class = Object.fromEntries(Object.entries(by.class || {}).map(([k, v]) => [k, v?.[branch] ? { [branch]: v[branch] } : {}]));
                out.orientation = Object.fromEntries(Object.entries(by.orientation || {}).map(([k, v]) => [k, v?.[branch] ? { [branch]: v[branch] } : {}]));
                out.pair = Object.fromEntries(Object.entries(by.pair || {}).map(([cls, obj]) => [cls, Object.fromEntries(Object.entries(obj || {}).map(([ori, map]) => [ori, map?.[branch] ? { [branch]: map[branch] } : {}]))]));
            } catch (_) {}
            return out;
        })(),
        branch_rating_counts_by: (() => {
            const out = { class: {}, orientation: {}, pair: {} };
            try {
                const by = data.branch_rating_counts_by || {};
                out.class = Object.fromEntries(Object.entries(by.class || {}).map(([k, v]) => [k, v?.[branch] ? { [branch]: v[branch] } : {}]));
                out.orientation = Object.fromEntries(Object.entries(by.orientation || {}).map(([k, v]) => [k, v?.[branch] ? { [branch]: v[branch] } : {}]));
                out.pair = Object.fromEntries(Object.entries(by.pair || {}).map(([cls, obj]) => [cls, Object.fromEntries(Object.entries(obj || {}).map(([ori, map]) => [ori, map?.[branch] ? { [branch]: map[branch] } : {}]))]));
            } catch (_) {}
            return out;
        })(),
        summary_all: data.summary
    };
}

// Safely recreate a canvas to force a clean Chart.js render
function resetCanvas(id) {
    const old = document.getElementById(id);
    if (!old) return null;
    try {
        const ch = (typeof Chart !== 'undefined' && Chart.getChart) ? Chart.getChart(old) : null;
        if (ch) ch.destroy();
    } catch (_) {}
    const parent = old.parentNode;
    const c = old.cloneNode(false);
    parent.replaceChild(c, old);
    return c.getContext('2d');
}

// Normalize any label to English by removing Tamil script and bracketed Tamil segments
function toEnglishLabel(s) {
    if (s == null) return s;
    let t = String(s);
    // Remove any parentheses group that contains Tamil characters
    t = t.replace(/\([^)]*[\u0B80-\u0BFF][^)]*\)/g, '');
    // Also remove parenthesized segments that contain high-ASCII mojibake
    t = t.replace(/\([^)]*[\x80-\xFF][^)]*\)/g, '');
    // Remove any remaining Tamil characters and high-ASCII mojibake
    t = t.replace(/[\u0B80-\u0BFF]/g, '');
    t = t.replace(/[\x80-\xFF]/g, '');
    // Normalize dashes and whitespace
    t = t.replace(/[–—]/g, '-');
    // Remove empty parentheses created by stripping
    t = t.replace(/\(\s*\)/g, '');
    t = t.replace(/\s{2,}/g, ' ').trim();
    // Clean trailing punctuation artifacts
    t = t.replace(/\s*[:;,-]\s*$/, '');
    // Fallback: if everything was stripped, return original to avoid empty labels
    return t || String(s);
}

// Post-render sanitizer: strip Tamil segments from any remaining displayed text nodes
function sanitizeDisplayedText(root=document) {
    try {
        const nodes = root.querySelectorAll('td, th, option, label, h2, .kpi .label, .reason-list li span:first-child');
        nodes.forEach(n => {
            if (n && typeof n.textContent === 'string') {
                const cleaned = toEnglishLabel(n.textContent);
                if (cleaned !== n.textContent) n.textContent = cleaned;
            }
        });
    } catch (_) {}
}

const RATING_BUCKETS = ['Excellent','Good','Average','Poor','Not Applicable','Unanswered'];
const RATING_BUCKET_COLORS = {
    Excellent: '#4caf50',
    Good: '#2196f3',
    Average: '#ff9800',
    Poor: '#e53935',
    'Not Applicable': '#90a4ae',
    Unanswered: '#cfd8dc'
};

function parseRatingBuckets(distObj) {
    let exc=0, good=0, avg=0, poor=0, na=0, un=0;
    for (const [k, v] of Object.entries(distObj||{})) {
        const raw = String(k);
        const low = raw.toLowerCase();
        const lowNorm = low.replace(/[\s./-]/g, '');
        const val = Number(v) || 0;
        const isAvg = low.includes('average') || low.includes('satisfactory') || low.includes('சராசரி') || low.includes('திருப்தி');
        const isNeed = low.includes('need') || low.includes('needs') || low.includes('improve') || low.includes('முன்னேற்றம்') || low.includes('மோசம்');
        const isNA = low.includes('not applicable') || low.includes('பொருந்தாது') || low === 'na' || low === 'n/a' || low === 'n.a' || lowNorm === 'notapplicable';
        const isUnanswered = low.includes('unanswered') || low === '';
        if (low.includes('excellent') || raw.trim()==='5' || low.includes('very good')) exc += val;
        else if (low.includes('good') || raw.trim()==='4') good += val;
        else if (isAvg || raw.trim()==='3') avg += val;
        else if (low.includes('poor') || isNeed || raw.trim()==='2' || raw.trim()==='1') poor += val;
        else if (isNA) na += val;
        else if (isUnanswered) un += val;
        else {
            const num = parseInt(raw, 10);
            if (num === 5) exc += val;
            else if (num === 4) good += val;
            else if (num === 3) avg += val;
            else if (num === 2 || num === 1) poor += val;
        }
    }
    return { exc, good, avg, poor, na, un };
}

// Sort subjects in the specified order for High School
function sortSubjects(subjects) {
    const highSchoolOrder = [
        'I Language',
        'II Language',
        'III Language',
        'Mathematics',
        'Physics',
        'Chemistry',
        'Biology',
        'Social Studies'
    ];

    const prePrimaryOrder = [
        'Literacy skills( English)',
        'Numeracy Skills (Math)',
        'General Awareness',
        'Second Language (NA for Pre-K)'
    ];

    const normalize = (s) => String(s).toLowerCase().trim().replace(/\s+/g, ' ');
    const hsMap = Object.fromEntries(highSchoolOrder.map((s, i) => [normalize(s), i]));
    const ppMap = Object.fromEntries(prePrimaryOrder.map((s, i) => [normalize(s), i]));

    return subjects.slice().sort((a, b) => {
        const normA = normalize(a);
        const normB = normalize(b);

        const hsA = hsMap[normA];
        const hsB = hsMap[normB];
        if (hsA !== undefined || hsB !== undefined) {
            if (hsA !== undefined && hsB !== undefined) return hsA - hsB;
            if (hsA !== undefined) return -1;
            return 1;
        }

        const ppA = ppMap[normA];
        const ppB = ppMap[normB];
        if (ppA !== undefined || ppB !== undefined) {
            if (ppA !== undefined && ppB !== undefined) return ppA - ppB;
            if (ppA !== undefined) return -1;
            return 1;
        }

        return String(a).localeCompare(String(b));
    });
}

function bucketCountGet(counts, bucket) {
    if (!counts) return 0;
    if (bucket === 'Excellent') return Number(counts.Excellent) || 0;
    if (bucket === 'Good') return Number(counts.Good) || 0;
    if (bucket === 'Average') return Number(counts.Average) || 0;
    if (bucket === 'Poor') return Number(counts.Poor) || 0;
    if (bucket === 'Not Applicable') return Number(counts['Not Applicable']) || 0;
    if (bucket === 'Unanswered') return Number(counts.Unanswered) || 0;
    return 0;
}

function avgFromBucketCounts(counts) {
    const exc = bucketCountGet(counts, 'Excellent');
    const good = bucketCountGet(counts, 'Good');
    const avg = bucketCountGet(counts, 'Average');
    const poor = bucketCountGet(counts, 'Poor');
    const denom = exc + good + avg + poor;
    if (!denom) return null;
    return (5 * exc + 4 * good + 3 * avg + 1 * poor) / denom;
}

function fmtAvgWithPct(avg) {
    if (avg == null || isNaN(avg)) return '-';
    const pct = (Number(avg) / 5) * 100;
    return `${Number(avg).toFixed(2)}/5 (${pct.toFixed(1)}%)`;
}

function renderAvgBucketsTable(tableId, rows) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const isSummary = tableId === 'summaryCategoryTable';
    if (isSummary) {
        table.style.tableLayout = 'auto';
        table.style.width = 'max-content';
        table.style.minWidth = '100%';
        table.style.wordBreak = 'normal';
        table.style.whiteSpace = 'nowrap';
    } else {
        table.style.tableLayout = 'fixed';
        table.style.width = '100%';
        table.style.wordBreak = 'break-word';
        table.style.whiteSpace = 'normal';
    }

    const header = '<thead><tr><th>Item</th><th style="text-align:right;">Avg</th><th style="text-align:right;">Excellent</th><th style="text-align:right;">Good</th><th style="text-align:right;">Average</th><th style="text-align:right;">Poor</th><th style="text-align:right;">Not Applicable</th><th style="text-align:right;">Unanswered</th><th style="text-align:right;">Total</th></tr></thead>';
    const body = (rows || []).map(r => {
        const label = r?.label;
        const counts = r?.counts || {};
        const total = RATING_BUCKETS.reduce((a,b)=> a + bucketCountGet(counts, b), 0);
        const fmt = (n) => {
            const v = Number(n) || 0;
            return total ? `${v.toLocaleString()} (${(v*100/total).toFixed(1)}%)` : v.toLocaleString();
        };
        const avg = (r && r.avg != null && !isNaN(r.avg)) ? Number(r.avg) : avgFromBucketCounts(counts);
        const numCell = (html) => `<td style="text-align:right; font-variant-numeric: tabular-nums;">${html}</td>`;
        return `<tr>`+
            `<td>${toEnglishLabel(label)}</td>`+
            `${numCell(fmtAvgWithPct(avg))}`+
            `${numCell(fmt(bucketCountGet(counts,'Excellent')))}`+
            `${numCell(fmt(bucketCountGet(counts,'Good')))}`+
            `${numCell(fmt(bucketCountGet(counts,'Average')))}`+
            `${numCell(fmt(bucketCountGet(counts,'Poor')))}`+
            `${numCell(fmt(bucketCountGet(counts,'Not Applicable')))}`+
            `${numCell(fmt(bucketCountGet(counts,'Unanswered')))}`+
            `${numCell(total.toLocaleString())}`+
        `</tr>`;
    }).join('');
    table.innerHTML = header + `<tbody>${body}</tbody>`;
}

const AvgValueLabelPlugin = {
    id: 'avgValueLabel',
    afterDatasetsDraw(chart, args, pluginOptions) {
        try {
            const opts = pluginOptions || {};
            const avgByLabel = opts.avgByLabel || null;
            const countsByLabel = opts.countsByLabel || null;
            if (!avgByLabel && !countsByLabel) return;
            const labelsFull = opts.labelsFull || null;
            if (!labelsFull) return;
            const indexAxis = chart?.options?.indexAxis || 'x';
            const ctx = chart.ctx;
            const dsCount = chart.data.datasets?.length || 0;
            if (!dsCount) return;
            const lastDs = chart.getDatasetMeta(dsCount - 1);
            if (!lastDs || !lastDs.data) return;

            const fontSize = opts.fontSize || 11;
            const color = opts.color || '#001f3f';
            const pad = opts.pad || 6;

            ctx.save();
            ctx.font = `800 ${fontSize}px Inter, -apple-system, Segoe UI, Roboto, Arial`;
            ctx.fillStyle = color;
            ctx.textAlign = (indexAxis === 'y') ? 'left' : 'center';
            ctx.textBaseline = 'middle';

            for (let i = 0; i < labelsFull.length; i++) {
                const key = labelsFull[i];
                const avg = (avgByLabel && avgByLabel[key] != null && !isNaN(avgByLabel[key]))
                    ? Number(avgByLabel[key])
                    : avgFromBucketCounts((countsByLabel && countsByLabel[key]) ? countsByLabel[key] : {});
                if (avg == null || isNaN(avg)) continue;
                const txt = Number(avg).toFixed(2);
                const el = lastDs.data[i];
                if (!el) continue;

                const props = el.getProps(['x','y'], true);
                if (indexAxis === 'y') {
                    // Horizontal bars: draw to the right end
                    ctx.fillText(txt, props.x + pad, props.y);
                } else {
                    // Vertical bars: draw above
                    ctx.fillText(txt, props.x, props.y - pad);
                }
            }
            ctx.restore();
        } catch (_) {}
    }
};

const BarValueLabelPlugin = {
    id: 'barValueLabel',
    afterDatasetsDraw(chart, args, pluginOptions) {
        try {
            const opts = pluginOptions || {};
            const datasetIndex = (opts.datasetIndex == null) ? 0 : Number(opts.datasetIndex);
            const meta = chart.getDatasetMeta(datasetIndex);
            if (!meta || meta.hidden || !meta.data) return;
            const dataArr = chart.data.datasets?.[datasetIndex]?.data || [];
            const indexAxis = chart?.options?.indexAxis || 'x';
            const fontSize = opts.fontSize || 11;
            const color = opts.color || '#001f3f';
            const pad = opts.pad || 6;
            const decimals = (opts.decimals == null) ? 2 : Number(opts.decimals);
            const suffix = opts.suffix || '';

            const ctx = chart.ctx;
            ctx.save();
            ctx.font = `900 ${fontSize}px Inter, -apple-system, Segoe UI, Roboto, Arial`;
            ctx.fillStyle = color;
            ctx.textBaseline = 'middle';

            for (let i = 0; i < meta.data.length; i++) {
                const el = meta.data[i];
                if (!el) continue;
                const raw = Number(dataArr[i]);
                if (raw == null || isNaN(raw)) continue;
                const txt = `${raw.toFixed(decimals)}${suffix}`;
                const props = el.getProps(['x','y','base'], true);
                if (indexAxis === 'y') {
                    ctx.textAlign = 'left';
                    ctx.fillText(txt, props.x + pad, props.y);
                } else {
                    ctx.textAlign = 'center';
                    ctx.fillText(txt, props.x, props.y - pad);
                }
            }
            ctx.restore();
        } catch (_) {}
    }
};

const PieValueLabelPlugin = {
    id: 'pieValueLabel',
    afterDatasetsDraw(chart, args, pluginOptions) {
        try {
            const opts = pluginOptions || {};
            const fontSize = opts.fontSize || 11;
            const color = opts.color || '#ffffff';
            const stroke = opts.stroke || 'rgba(0,0,0,0.45)';
            const minFraction = (opts.minFraction == null) ? 0.04 : Number(opts.minFraction);
            const dsCount = chart.data.datasets?.length || 0;
            if (!dsCount) return;

            const ctx = chart.ctx;
            ctx.save();
            ctx.font = `900 ${fontSize}px Inter, -apple-system, Segoe UI, Roboto, Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 3;

            for (let di = 0; di < dsCount; di++) {
                const meta = chart.getDatasetMeta(di);
                if (!meta || meta.hidden || !meta.data) continue;
                const dataArr = chart.data.datasets[di].data || [];
                const total = dataArr.reduce((a,b)=> a + (Number(b)||0), 0);
                if (!total) continue;
                for (let i = 0; i < meta.data.length; i++) {
                    const arc = meta.data[i];
                    const val = Number(dataArr[i]) || 0;
                    if (!val) continue;
                    const frac = val / total;
                    if (minFraction && frac < minFraction) continue;
                    const props = arc.getProps(['x','y','startAngle','endAngle','innerRadius','outerRadius'], true);
                    const angle = (props.startAngle + props.endAngle) / 2;
                    const r = (props.innerRadius + props.outerRadius) / 2;
                    const x = props.x + Math.cos(angle) * r;
                    const y = props.y + Math.sin(angle) * r;
                    const txt = val.toLocaleString();
                    ctx.strokeText(txt, x, y);
                    ctx.fillText(txt, x, y);
                }
            }
            ctx.restore();
        } catch (_) {}
    }
};

const StackedValueLabelPlugin = {
    id: 'stackedValueLabel',
    afterDatasetsDraw(chart, args, pluginOptions) {
        try {
            const opts = pluginOptions || {};
            const showSegments = opts.showSegments !== false;
            const showTotal = opts.showTotal !== false;
            const indexAxis = chart?.options?.indexAxis || 'x';
            const ctx = chart.ctx;
            const dsCount = chart.data.datasets?.length || 0;
            if (!dsCount) return;
            const nPoints = (chart.data.labels || []).length;
            if (!nPoints) return;

            const fontSize = opts.fontSize || 11;
            const color = opts.color || '#ffffff';
            const totalColor = opts.totalColor || '#001f3f';
            const pad = opts.pad || 6;
            const minPx = opts.minPx || 18;

            ctx.save();
            ctx.font = `900 ${fontSize}px Inter, -apple-system, Segoe UI, Roboto, Arial`;
            ctx.textBaseline = 'middle';

            for (let di = 0; di < dsCount; di++) {
                const meta = chart.getDatasetMeta(di);
                if (!meta || meta.hidden || !meta.data) continue;
                for (let i = 0; i < nPoints; i++) {
                    const el = meta.data[i];
                    if (!el) continue;
                    const rawVal = (indexAxis === 'y') ? (chart.data.datasets[di].data?.[i] ?? 0) : (chart.data.datasets[di].data?.[i] ?? 0);
                    const val = Number(rawVal) || 0;
                    if (!val) continue;
                    const txt = Number(val).toLocaleString();
                    const props = el.getProps(['x','y','base'], true);
                    if (indexAxis === 'y') {
                        const w = props.x - props.base;
                        if (!showSegments || w < minPx) continue;
                        const tw = ctx.measureText(txt).width;
                        if (tw + 8 > w) continue;
                        ctx.fillStyle = color;
                        ctx.textAlign = 'center';
                        ctx.fillText(txt, props.base + (w / 2), props.y);
                    } else {
                        const h = props.base - props.y;
                        if (!showSegments || h < minPx) continue;
                        ctx.fillStyle = color;
                        ctx.textAlign = 'center';
                        ctx.fillText(txt, props.x, props.y + (h / 2));
                    }
                }
            }

            if (showTotal) {
                const lastMeta = chart.getDatasetMeta(dsCount - 1);
                if (lastMeta && lastMeta.data) {
                    for (let i = 0; i < nPoints; i++) {
                        let tot = 0;
                        for (let di = 0; di < dsCount; di++) tot += Number(chart.data.datasets[di].data?.[i] || 0);
                        if (!tot) continue;
                        const el = lastMeta.data[i];
                        if (!el) continue;
                        const props = el.getProps(['x','y'], true);
                        ctx.fillStyle = totalColor;
                        if (indexAxis === 'y') {
                            ctx.textAlign = 'left';
                            ctx.fillText(String(tot), props.x + pad, props.y);
                        } else {
                            ctx.textAlign = 'center';
                            ctx.fillText(String(tot), props.x, props.y - pad);
                        }
                    }
                }
            }

            ctx.restore();
        } catch (_) {}
    }
};

function renderBucketStackedChart(canvasId, labelList, countsByLabel, opts={}) {
    const ctx = (typeof resetCanvas === 'function' ? resetCanvas(canvasId) : null) || document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    const labelsFull = labelList.slice();
    const truncate = (s, n=38) => (s && s.length>n) ? (s.slice(0,n-1)+'…') : s;
    const labels = labelsFull.map(s => truncate(toEnglishLabel(s)));
    const datasets = RATING_BUCKETS.map(bucket => ({
        label: bucket,
        backgroundColor: RATING_BUCKET_COLORS[bucket],
        barPercentage: 0.9,
        categoryPercentage: 0.9,
        data: labelsFull.map(l => bucketCountGet(countsByLabel?.[l], bucket))
    }));
    const indexAxis = opts.indexAxis || 'y';

    const pluginsArr = [AvgValueLabelPlugin];
    if (opts.showCountLabels !== false) pluginsArr.push(StackedValueLabelPlugin);
    new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis,
            plugins: {
                legend: { position: 'bottom' },
                avgValueLabel: opts.showAvgLabel ? { countsByLabel, labelsFull, fontSize: opts.avgFontSize || 11 } : false,
                stackedValueLabel: (opts.showCountLabels !== false) ? { showSegments: true, showTotal: false, fontSize: opts.countFontSize || 10, minPx: opts.countMinPx || 20 } : false,
                tooltip: {
                    callbacks: {
                        title: (tt) => {
                            const idx = tt[0].dataIndex;
                            const key = labelsFull[idx];
                            const counts = countsByLabel?.[key] || {};
                            const avg = avgFromBucketCounts(counts);
                            const avgStr = (avg == null || isNaN(avg)) ? '-' : `${avg.toFixed(2)}/5 (${((avg/5)*100).toFixed(1)}%)`;
                            const total = RATING_BUCKETS.reduce((a,b)=> a + bucketCountGet(counts, b), 0);
                            const nStr = total ? ` • n=${total.toLocaleString()}` : '';
                            return `${toEnglishLabel(key)} — Avg ${avgStr}${nStr}`;
                        },
                        label: (ctx) => {
                            const lab = labelsFull[ctx.dataIndex];
                            const counts = countsByLabel?.[lab] || {};
                            const total = RATING_BUCKETS.reduce((a,b)=> a + bucketCountGet(counts, b), 0);
                            const val = (indexAxis === 'y') ? (ctx.parsed.x || 0) : (ctx.parsed.y || 0);
                            const pct = total ? `${(val*100/total).toFixed(1)}%` : '';
                            return `${ctx.dataset.label}: ${Number(val).toLocaleString()}${pct ? ` (${pct})` : ''}`;
                        }
                    }
                }
            },
            scales: {
                x: { stacked: true, beginAtZero: true },
                y: { stacked: true, ticks: { autoSkip: false, font: { size: 10 } } }
            }
        },
        plugins: pluginsArr
    });
}

// Helper: approximate respondent count (n) for a given item label by scanning category_performance
function findItemCountInCategories(data, label) {
    try {
        const norm = toEnglishLabel(label).toLowerCase();
        const catPerf = data?.category_performance || {};
        for (const [, items] of Object.entries(catPerf)) {
            for (const [name, obj] of Object.entries(items || {})) {
                const nm = toEnglishLabel(name).toLowerCase();
                if (!nm) continue;
                if (nm === norm || nm.includes(norm) || norm.includes(nm)) {
                    const dist = obj?.rating_distribution || {};
                    let total = 0;
                    for (const v of Object.values(dist)) total += (v || 0);
                    if (total > 0) return total;
                }
            }
        }
    } catch (_) {}
    return null;
}

// Render all primary sections (except the global branch comparison)
function renderAllSections(viewData) {
    try { renderExecutiveSummary(viewData); } catch (e) { console.error(e); }
    try { renderAcademicSection(viewData); } catch (e) { console.error(e); }
    try { renderEnvironmentSection(viewData); } catch (e) { console.error(e); }
    try { renderCommunicationSection(viewData); } catch (e) { console.error(e); }
    try { renderInfrastructureSection(viewData); } catch (e) { console.error(e); }
    try { renderStrengthsSection(viewData); } catch (e) { console.error(e); }
    try { renderBranchComparisonSection(viewData); } catch (e) { console.error(e); }
}

// Create collapsible toggles for each section and wire expand/collapse buttons
function initAccordion() {
    const titles = {
        'section-exec': 'Executive Summary',
        'section-academic': 'Academic Quality',
        'section-env': 'Environment & Safety',
        'section-comm': 'Communication & Administration',
        'section-infra': 'Infrastructure & Facilities',
        'section-strengths': 'Strengths & Improvements',
        'section-branch': 'Branch Comparison'
    };
    document.querySelectorAll('.section').forEach(sec => {
        if (sec.querySelector('.section-toggle')) return;
        const id = sec.id;
        const toggle = document.createElement('div');
        toggle.className = 'section-toggle';
        toggle.innerHTML = `<span>${titles[id] || id}</span><span>▼</span>`;
        const content = document.createElement('div');
        content.className = 'section-content';
        while (sec.firstChild) content.appendChild(sec.firstChild);
        sec.appendChild(toggle);
        sec.appendChild(content);
        toggle.addEventListener('click', ()=> sec.classList.toggle('collapsed'));
    });
    const exp = document.getElementById('expandAllBtn');
    const col = document.getElementById('collapseAllBtn');
    if (exp) exp.addEventListener('click', ()=> document.querySelectorAll('.section').forEach(s=> s.classList.remove('collapsed')));
    if (col) col.addEventListener('click', ()=> document.querySelectorAll('.section').forEach(s=> s.classList.add('collapsed')));
}

// Populate State and City selectors with dependent filtering
let __stateCitySelectorWired = false;
function initStateCitySelectors(data) {
    const stateSel = document.getElementById('globalStateSelect');
    const citySel = document.getElementById('globalCitySelect');
    if (!stateSel || !citySel) return;

    const states = Object.keys(data.summary?.states || {}).sort();
    const stateToBranches = data.state_to_branches || {};

    // Populate state dropdown once
    if (stateSel.options.length <= 1) {
        states.forEach(s => {
            const o = document.createElement('option');
            o.value = s;
            o.textContent = toEnglishLabel(s);
            stateSel.appendChild(o);
        });
    }

    // Attach event listeners only once
    if (!__stateCitySelectorWired) {
        __stateCitySelectorWired = true;

        // State change: update City dropdown and re-render
        stateSel.addEventListener('change', () => {
            CURRENT_STATE = stateSel.value || '';
            CURRENT_CITY = ''; // Reset city when state changes

            // Update city dropdown based on selected state
            citySel.innerHTML = '<option value="">All Cities</option>';
            if (CURRENT_STATE) {
                const cities = stateToBranches[CURRENT_STATE] || [];
                cities.forEach(c => {
                    const o = document.createElement('option');
                    o.value = c;
                    o.textContent = toEnglishLabel(c);
                    citySel.appendChild(o);
                });
                
                // Auto-select first city in the state
                if (cities.length > 0) {
                    CURRENT_CITY = cities[0];
                    citySel.value = CURRENT_CITY;
                }
            } else {
                // All States: show all cities
                const allCities = Object.keys(data.summary?.branches || {}).sort();
                allCities.forEach(c => {
                    const o = document.createElement('option');
                    o.value = c;
                    o.textContent = toEnglishLabel(c);
                    citySel.appendChild(o);
                });
            }

            // Set CURRENT_BRANCH for compatibility with existing code
            CURRENT_BRANCH = CURRENT_CITY;
            console.log('🔄 State changed to:', CURRENT_STATE, 'City auto-selected:', CURRENT_CITY);
            const view = deriveViewData(RAW_DATA, CURRENT_BRANCH);
            renderAllSections(view);
            renderComparison(view);
            sanitizeDisplayedText();
        });

        // City change: re-render
        citySel.addEventListener('change', () => {
            CURRENT_CITY = citySel.value || '';
            CURRENT_BRANCH = CURRENT_CITY; // For compatibility
            const view = deriveViewData(RAW_DATA, CURRENT_BRANCH);
            renderAllSections(view);
            renderComparison(view);
            sanitizeDisplayedText();
        });
    }

    // Initialize city dropdown for "All States"
    const allCities = Object.keys(data.summary?.branches || {}).sort();
    if (citySel.options.length <= 1) {
        allCities.forEach(c => {
            const o = document.createElement('option');
            o.value = c;
            o.textContent = toEnglishLabel(c);
            citySel.appendChild(o);
        });
    }
}

// Initialize Academic Class and Orientation filters
let __academicFiltersWired = false;
function initAcademicFilters(data) {
    const classSel = document.getElementById('academicClassFilter');
    const orientSel = document.getElementById('academicOrientationFilter');
    if (!classSel || !orientSel) return;

    const classes = Object.keys(data.summary?.classes || {}).sort();
    const orientations = Object.keys(data.summary?.orientations || {}).sort();

    // Populate dropdowns once
    if (classSel.options.length <= 1) {
        classes.forEach(c => {
            const o = document.createElement('option');
            o.value = c;
            o.textContent = toEnglishLabel(c);
            classSel.appendChild(o);
        });
    }
    if (orientSel.options.length <= 1) {
        orientations.forEach(ori => {
            const o = document.createElement('option');
            o.value = ori;
            o.textContent = toEnglishLabel(ori);
            orientSel.appendChild(o);
        });
    }

    // Attach event listeners only once
    if (!__academicFiltersWired) {
        __academicFiltersWired = true;

        classSel.addEventListener('change', () => {
            CURRENT_ACADEMIC_CLASS = classSel.value || '';
            const view = deriveViewData(RAW_DATA, CURRENT_BRANCH);
            try { renderAcademicSection(view); } catch (e) { console.error(e); }
            sanitizeDisplayedText();
        });

        orientSel.addEventListener('change', () => {
            CURRENT_ACADEMIC_ORIENTATION = orientSel.value || '';
            const view = deriveViewData(RAW_DATA, CURRENT_BRANCH);
            try { renderAcademicSection(view); } catch (e) { console.error(e); }
            sanitizeDisplayedText();
        });
    }
}

function renderDashboard(data) {
    console.log('🎬 renderDashboard called');
    console.log('📦 RAW_DATA summary:', {
        totalResponses: data.summary?.total_responses,
        subjectKeys: Object.keys(data.subject_performance || {}),
        programExcKeys: Object.keys(data.program_excellence || {}),
        states: Object.keys(data.summary?.states || {}).length,
        branches: Object.keys(data.summary?.branches || {}).length
    });
    
    applyResponsiveChartDefaults();
    initTabs();
    initAccordion();
    populateFilters(data);
    initCompareControls();
    initStateCitySelectors(data);
    initAcademicFilters(data);
    const view = deriveViewData(data, CURRENT_BRANCH);
    
    console.log('📊 View data for rendering:', {
        totalResponses: view.summary?.total_responses,
        subjectKeys: Object.keys(view.subject_performance || {}),
        programExcKeys: Object.keys(view.program_excellence || {})
    });
    
    renderAllSections(view);
    renderComparison(view);
    sanitizeDisplayedText();
    console.log('✅ renderDashboard completed');
}

function getCompareBy() {
    const sel = document.getElementById('compareBySelect');
    return sel ? sel.value : 'none';
}

function ensureCompareArea(sectionId) {
    const sec = document.getElementById(sectionId);
    if (!sec) return null;
    const content = sec.querySelector('.section-content') || sec; // fallback if accordion not applied
    let area = content.querySelector('.compare-area');
    if (!area) {
        area = document.createElement('div');
        area.className = 'compare-area';
        area.style.display = 'grid';
        area.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
        area.style.gap = '14px';
        area.style.margin = '10px 0 18px';
        content.insertBefore(area, content.firstChild);
    }
    area.innerHTML = '';
    return area;
}

function initCompareControls() {
    const cmpSel = document.getElementById('compareBySelect');
    const segWrap = document.getElementById('segmentChecks');
    if (!cmpSel) return;
    const rebuildSegChecks = () => {
        if (!segWrap) return;
        const br = CURRENT_BRANCH || Object.keys(RAW_DATA?.branch_segment_performance || {})[0];
        const segs = Object.keys(RAW_DATA?.branch_segment_performance?.[br] || {});
        segWrap.style.display = (cmpSel.value === 'segment') ? 'inline-flex' : 'none';
        segWrap.innerHTML = '';
        if (cmpSel.value === 'segment') {
            segs.forEach((s, idx) => {
                const id = `segchk_${s.replace(/[^a-z0-9]/gi,'_').toLowerCase()}`;
                const lbl = document.createElement('label');
                lbl.style.display = 'inline-flex';
                lbl.style.alignItems = 'center';
                lbl.style.gap = '6px';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.id = id; cb.value = s; cb.checked = true;
                cb.addEventListener('change', ()=> renderComparison(deriveViewData(RAW_DATA, CURRENT_BRANCH)));
                lbl.appendChild(cb);
                const span = document.createElement('span'); span.textContent = toEnglishLabel(s); lbl.appendChild(span);
                segWrap.appendChild(lbl);
            });
        }
    };
    cmpSel.addEventListener('change', () => { rebuildSegChecks(); renderComparison(deriveViewData(RAW_DATA, CURRENT_BRANCH)); });
    // rebuild when branch changes as well
    const branchSel = document.getElementById('globalBranchSelect');
    if (branchSel) branchSel.addEventListener('change', rebuildSegChecks);
    rebuildSegChecks();
}

function selectedSegments() {
    const segWrap = document.getElementById('segmentChecks');
    if (!segWrap) return [];
    const cbs = Array.from(segWrap.querySelectorAll('input[type="checkbox"]'));
    const vals = cbs.filter(cb => cb.checked).map(cb => cb.value);
    return vals.length ? vals : cbs.map(cb => cb.value);
}

function renderComparison(view) {
    const by = getCompareBy();
    // Clear any existing compare areas
    document.querySelectorAll('.compare-area').forEach(n => n.remove());
    if (by === 'none') return;

    if (!CURRENT_BRANCH) return; // require a branch to compare within

    if (by === 'segment') {
        renderSegmentComparison();
    } else if (by === 'class' || by === 'orientation') {
        renderGroupComparison(by);
    }
    sanitizeDisplayedText();
}

// Render simple 3-bar chart for Segment Overall within selected branch
function aggregateSegments(branch) {
    const order = ['Pre Primary','Primary','High School'];
    const perfByBranch = RAW_DATA?.branch_segment_performance || {};
    const recByBranch = RAW_DATA?.branch_segment_recommendation_counts || {};
    const result = {};
    if (branch) {
        console.log('📊 Aggregating segments for branch:', branch);
        const p = perfByBranch[branch] || {};
        const r = recByBranch[branch] || {};
        console.log('📊 Branch segment performance:', p);
        console.log('📊 Branch segment recommendations:', r);
        order.forEach(seg => {
            if (!p[seg] && !r[seg]) return;
            const pc = p[seg] || {};
            const rc = r[seg] || {};
            result[seg] = {
                count: pc.count || ((rc.Yes||0)+(rc.No||0)+(rc.Maybe||0)+(rc['Not Applicable']||0)),
                overall_avg: (pc.overall_avg!=null && !isNaN(pc.overall_avg)) ? pc.overall_avg : null,
                rec: { Yes: rc.Yes||0, No: rc.No||0, Maybe: rc.Maybe||0 }
            };
        });
        console.log('📊 Aggregated segment result:', result);
        return result;
    }
    // Aggregate across all branches
    for (const [br, segs] of Object.entries(perfByBranch)) {
        for (const [seg, vals] of Object.entries(segs)) {
            if (!result[seg]) result[seg] = { count: 0, overall_wsum: 0, overall_avg: null, rec: { Yes:0, No:0, Maybe:0 } };
            const rc = ((recByBranch[br]||{})[seg]) || {};
            const c = vals.count || ((rc.Yes||0)+(rc.No||0)+(rc.Maybe||0)+(rc['Not Applicable']||0)) || 0;
            result[seg].count += c;
            if (vals.overall_avg!=null && !isNaN(vals.overall_avg) && c) result[seg].overall_wsum += vals.overall_avg * c;
        }
    }
    for (const [, segs] of Object.entries(recByBranch)) {
        for (const [seg, rc] of Object.entries(segs)) {
            if (!result[seg]) result[seg] = { count: 0, overall_wsum: 0, overall_avg: null, rec: { Yes:0, No:0, Maybe:0 } };
            result[seg].rec.Yes += rc.Yes || 0;
            result[seg].rec.No += rc.No || 0;
            result[seg].rec.Maybe += rc.Maybe || 0;
        }
    }
    Object.keys(result).forEach(seg => {
        const c = result[seg].count || 0;
        result[seg].overall_avg = c ? (result[seg].overall_wsum / c) : null;
    });
    return result;
}

function renderSegmentOverallChart() {
    const order = ['Pre Primary','Primary','High School'];
    const agg = aggregateSegments(CURRENT_BRANCH);
    const labels = order.filter(s => agg[s]);
    const el = document.getElementById('segmentOverallChart');
    if (!el || !labels.length) return;
    const values = labels.map(s => (agg[s].overall_avg==null || isNaN(agg[s].overall_avg)) ? 0 : agg[s].overall_avg);
    const ctx = (typeof resetCanvas === 'function' ? resetCanvas('segmentOverallChart') : null) || el.getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Overall Avg', data: values, backgroundColor: ['#42a5f5','#66bb6a','#ffa726'].slice(0, labels.length) }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 20 } },
            scales: { y: { beginAtZero: true, max: 5 } },
            plugins: { barValueLabel: { decimals: 2, fontSize: 12 } }
        },
        plugins: [BarValueLabelPlugin]
    });
}

function renderSegmentCountsGrid() {
    const grid = document.getElementById('segmentCountsGrid');
    if (!grid) return;
    console.log('📊 renderSegmentCountsGrid called, CURRENT_BRANCH:', CURRENT_BRANCH);
    const order = ['Pre Primary','Primary','High School'];
    const agg = aggregateSegments(CURRENT_BRANCH);
    console.log('📊 Aggregated data for counts:', agg);
    const segs = order.filter(s => agg[s]);
    grid.innerHTML = segs.map(s => {
        const d = agg[s];
        const total = d.count || 0;
        const y = d.rec?.Yes || 0, n = d.rec?.No || 0, m = d.rec?.Maybe || 0;
        const den = y + n + m;
        const pct = (v) => den ? ` (${(v/den*100).toFixed(1)}%)` : '';
        return `
            <div class="kpi"><div class="label">${toEnglishLabel(s)} — Responses</div><div class="value">${(total||0).toLocaleString()}</div></div>
            <div class="kpi"><div class="label">${toEnglishLabel(s)}: Yes</div><div class="value">${y.toLocaleString()}${pct(y)}</div></div>
            <div class="kpi"><div class="label">${toEnglishLabel(s)}: No</div><div class="value">${n.toLocaleString()}${pct(n)}</div></div>
            <div class="kpi"><div class="label">${toEnglishLabel(s)}: Maybe</div><div class="value">${m.toLocaleString()}${pct(m)}</div></div>
        `;
    }).join('');
}

function renderSegmentTotalsGrid() {
    const grid = document.getElementById('segmentTotalsGrid');
    if (!grid) return;
    console.log('📊 renderSegmentTotalsGrid called, CURRENT_BRANCH:', CURRENT_BRANCH);
    const order = ['Pre Primary','Primary','High School'];
    const agg = aggregateSegments(CURRENT_BRANCH);
    console.log('📊 Aggregated data for totals:', agg);
    const segs = order.filter(s => agg[s]);
    if (!segs.length) { grid.innerHTML = '<div class="kpi"><div class="label">No responses</div><div class="value">0</div></div>'; return; }
    grid.innerHTML = segs.map(s => {
        const d = agg[s];
        const total = d.count || 0;
        return `<div class="kpi"><div class="label">${s} — Total Responses</div><div class="value">${(total||0).toLocaleString()}</div></div>`;
    }).join('');
}

function renderSegmentYNMChart() {
    const canvas = document.getElementById('segmentYNMChart');
    if (!canvas) return;
    const order = ['Pre Primary','Primary','High School'];
    const agg = aggregateSegments(CURRENT_BRANCH);
    const labels = order.filter(s => agg[s]);
    if (!labels.length) return;
    const yes = labels.map(l => (agg[l].rec?.Yes||0));
    const maybe = labels.map(l => (agg[l].rec?.Maybe||0));
    const no = labels.map(l => (agg[l].rec?.No||0));
    const avgByLabel = Object.fromEntries(labels.map(l => [l, (agg[l].overall_avg!=null && !isNaN(agg[l].overall_avg)) ? agg[l].overall_avg : null]));
    const totals = labels.map((_, i) => (Number(yes[i])||0) + (Number(maybe[i])||0) + (Number(no[i])||0));
    const ctx = (typeof resetCanvas === 'function' ? resetCanvas('segmentYNMChart') : null) || canvas.getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Yes', data: yes, backgroundColor: '#43a047', stack: 'ynm' },
                { label: 'Maybe', data: maybe, backgroundColor: '#fb8c00', stack: 'ynm' },
                { label: 'No', data: no, backgroundColor: '#e53935', stack: 'ynm' }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { right: 34 } },
            plugins: {
                legend: { position: 'bottom' },
                avgValueLabel: { avgByLabel, labelsFull: labels, fontSize: 11 },
                stackedValueLabel: { showSegments: true, showTotal: false, fontSize: 10, minPx: 20 },
                tooltip: {
                    callbacks: {
                        title: (tt) => {
                            const idx = tt[0].dataIndex;
                            const key = labels[idx];
                            const avg = avgByLabel?.[key];
                            const avgStr = (avg == null || isNaN(avg)) ? '-' : `${Number(avg).toFixed(2)}/5 (${((Number(avg)/5)*100).toFixed(1)}%)`;
                            const n = totals[idx] || 0;
                            return `${toEnglishLabel(key)} — Avg ${avgStr} • n=${n.toLocaleString()}`;
                        },
                        label: (ctx) => {
                            const idx = ctx.dataIndex;
                            const n = totals[idx] || 0;
                            const val = ctx.parsed.x || 0;
                            const pct = n ? `${(val*100/n).toFixed(1)}%` : '';
                            return `${ctx.dataset.label}: ${Number(val).toLocaleString()}${pct ? ` (${pct})` : ''}`;
                        }
                    }
                }
            },
            scales: {
                x: { stacked: true, beginAtZero: true },
                y: { stacked: true }
            }
        },
        plugins: [AvgValueLabelPlugin, StackedValueLabelPlugin]
    });
}

function card(title) {
    const d = document.createElement('div');
    d.className = 'chart-container';
    const h = document.createElement('h2'); h.textContent = title; d.appendChild(h);
    return d;
}

function renderSegmentComparison() {
    const perf = RAW_DATA?.branch_segment_performance?.[CURRENT_BRANCH] || {};
    const recs = RAW_DATA?.branch_segment_recommendation_counts?.[CURRENT_BRANCH] || {};
    const reasons = RAW_DATA?.branch_segment_recommendation_reasons?.[CURRENT_BRANCH] || {};
    const segs = selectedSegments().filter(s => perf[s]);
    if (!segs.length) return;

    // Executive Summary overlay: per-segment KPI + donut + reasons
    const area = ensureCompareArea('section-exec');
    if (area) {
        // Aggregated Recommendations (across all selected segments)
        try {
            const agg = { Yes: {}, No: {}, Maybe: {} };
            const add = (bucket, label, count) => { agg[bucket][label] = (agg[bucket][label]||0) + count; };
            segs.forEach(s => {
                const rr = reasons[s] || {};
                ['Yes','No','Maybe'].forEach(b => {
                    const list = rr[b]?.top_detail || [];
                    list.forEach(([label, count]) => add(b, label, Number(count)||0));
                });
            });
            const toTop = (obj) => Object.entries(obj).sort((a,b)=> b[1]-a[1]).slice(0,6);
            const topYes = toTop(agg.Yes);
            const topImprove = toTop(Object.keys(agg.No).concat(Object.keys(agg.Maybe)).reduce((acc,k)=>{ acc[k]=(agg.No[k]||0)+(agg.Maybe[k]||0); return acc; }, {}));
            const cardAgg = card(`Recommendations — ${toEnglishLabel(CURRENT_BRANCH)}`);
            const wrapAgg = document.createElement('div'); wrapAgg.className = 'grid-2';
            const strengths = document.createElement('div'); strengths.className = 'kpi';
            strengths.innerHTML = `<div class="reason-title yes">Top Strengths (Why Yes)</div><ul class="reason-list">${topYes.map(([l,c])=> `<li><span>${toEnglishLabel(l)}</span><span>${c}</span></li>`).join('')}</ul>`;
            const improv = document.createElement('div'); improv.className = 'kpi';
            improv.innerHTML = `<div class=\"reason-title no\">Top Improvements (Why No/Maybe)</div><ul class=\"reason-list\">${topImprove.map(([l,c])=> `<li style=\"display:flex;justify-content:space-between;\"><span>${toEnglishLabel(l)}</span><span>${c}</span></li>`).join('')}</ul>`;
            wrapAgg.appendChild(strengths); wrapAgg.appendChild(improv); cardAgg.appendChild(wrapAgg); area.appendChild(cardAgg);
        } catch (_e) {}

        segs.forEach((s, idx) => {
            const p = perf[s] || {};
            const r = recs[s] || {};
            const total = (r.Yes||0)+(r.No||0)+(r.Maybe||0);
            const yesPct = total ? (r.Yes*100/total) : 0;
            const c = card(`${toEnglishLabel(s)} — ${toEnglishLabel(CURRENT_BRANCH)}`);
            const k = document.createElement('div');
            k.className = 'kpi-grid';
            k.innerHTML = `
                <div class="kpi"><div class="label">Responses</div><div class="value">${(p.count||0).toLocaleString()}</div></div>
                <div class="kpi"><div class="label">Overall</div><div class="value">${p.overall_avg? (p.overall_avg/5*100).toFixed(1)+'%':'-'}</div></div>
                <div class="kpi"><div class="label">Academics</div><div class="value">${p.subject_avg? p.subject_avg.toFixed(2):'-'}</div></div>
                <div class="kpi"><div class="label">Environment</div><div class="value">${p.environment_avg? p.environment_avg.toFixed(2):'-'}</div></div>
                <div class="kpi"><div class="label">Infrastructure</div><div class="value">${p.infrastructure_avg? p.infrastructure_avg.toFixed(2):'-'}</div></div>
                <div class="kpi"><div class="label">Admin</div><div class="value">${p.admin_avg? p.admin_avg.toFixed(2):'-'}</div></div>
                <div class="kpi"><div class="label">% Recommend</div><div class="value">${yesPct.toFixed(1)}%</div></div>`;
            c.appendChild(k);
            const row = document.createElement('div'); row.className = 'chart-row';
            const wrap = document.createElement('div'); wrap.className = 'chart-wrapper';
            const canvas = document.createElement('canvas'); const cid = `segdonut_${idx}`; canvas.id = cid; wrap.appendChild(canvas);
            row.appendChild(wrap);
            const side = document.createElement('div'); side.className = 'side-kpi';
            const listCard = document.createElement('div'); listCard.className = 'kpi';
            const title = document.createElement('div'); title.className = 'label'; title.textContent = 'Reasons (Top votes)'; listCard.appendChild(title);
            const ul = document.createElement('ul'); ul.style.listStyle='none'; ul.style.padding='0';
            const rrYes = reasons[s]?.Yes?.top_detail || [];
            const rrNo = reasons[s]?.No?.top_detail || [];
            const build = (arr, hdr) => `<li style="font-weight:700;margin-top:6px;">${hdr}</li>` + arr.map(([label,count,pct])=> `<li style=\"display:flex;justify-content:space-between;\"><span>${toEnglishLabel(label)}</span><span>${count} (${pct}%)</span></li>`).join('');
            ul.innerHTML = build(rrYes, 'Why Yes') + build(rrNo, 'Why No');
            listCard.appendChild(ul);
            side.appendChild(listCard);
            row.appendChild(side);
            c.appendChild(row);
            area.appendChild(c);
            // chart
            const ctx = canvas.getContext('2d');
            new Chart(ctx, { type: 'doughnut', data: { labels: ['Yes','No','Maybe'], datasets: [{ data: [r.Yes||0, r.No||0, r.Maybe||0], backgroundColor: ['#43a047','#e53935','#fb8c00'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, pieValueLabel: { fontSize: 11 } } }, plugins: [PieValueLabelPlugin] });
        });
    }

    // Add compact per-section segment cards
    addSegmentCards('section-academic', segs, perf, 'subject_avg', '%SEG% — Academics');
    addSegmentCards('section-env', segs, perf, 'environment_avg', '%SEG% — Environment');
    addSegmentCards('section-comm', segs, perf, 'admin_avg', '%SEG% — Admin Support');
    addSegmentCards('section-infra', segs, perf, 'infrastructure_avg', '%SEG% — Infrastructure');
    addSegmentCards('section-strengths', segs, perf, 'overall_avg', '%SEG% — Overall');
}

function addSegmentCards(sectionId, segs, perf, metricKey, titleFmt) {
    const area2 = ensureCompareArea(sectionId);
    if (!area2) return;
    segs.forEach((s) => {
        const p = perf[s] || {};
        const val = p[metricKey];
        const c = card(titleFmt.replace('%SEG%', toEnglishLabel(s)));
        const k = document.createElement('div'); k.className = 'kpi-grid';
        k.innerHTML = `
            <div class="kpi"><div class="label">Responses</div><div class="value">${(p.count||0).toLocaleString()}</div></div>
            <div class="kpi"><div class="label">${metricKey.replace('_',' ')}</div><div class="value">${val? val.toFixed(2):'-'}</div></div>`;
        c.appendChild(k);
        area2.appendChild(c);
    });
}

function renderGroupComparison(kind) {
    // kind in ['class','orientation']
    const area = ensureCompareArea('section-branch') || ensureCompareArea('section-exec');
    if (!area) return;
    const br = CURRENT_BRANCH;
    const recBy = RAW_DATA?.branch_recommendation_counts_by?.[kind] || {};
    const ratingBy = RAW_DATA?.branch_rating_counts_by?.[kind] || {};
    let keys = Object.keys(recBy);
    // Keep only those where current branch has data
    keys = keys.filter(k => recBy[k] && recBy[k][br]);
    // Custom sort depending on kind
    if (kind === 'class') {
        const pref = ['IK-2','IK2','IK-1','IK1','Pre-K','LKG','UKG'];
        keys.sort((a,b)=>{
            const norm = s=> String(s);
            const ia = pref.findIndex(p=> norm(a).toUpperCase().includes(p.toUpperCase()));
            const ib = pref.findIndex(p=> norm(b).toUpperCase().includes(p.toUpperCase()));
            if (ia!==-1 || ib!==-1) return (ia===-1? 999:ia) - (ib===-1? 999:ib);
            return a.localeCompare(b);
        });
    } else if (kind === 'orientation') {
        const prefO = ['Techno','Star','Maverick','Maverics'];
        keys.sort((a,b)=>{
            const norm = s=> String(s);
            const ia = prefO.findIndex(p=> norm(a).toUpperCase().includes(p.toUpperCase()));
            const ib = prefO.findIndex(p=> norm(b).toUpperCase().includes(p.toUpperCase()));
            if (ia!==-1 || ib!==-1) return (ia===-1? 999:ia) - (ib===-1? 999:ib);
            return a.localeCompare(b);
        });
    } else {
        keys.sort();
    }
    keys.forEach((k, idx) => {
        const c = card(`${toEnglishLabel(k)} — ${toEnglishLabel(br)}`);
        const rec = recBy[k]?.[br] || {};
        const total = (rec.Yes||0)+(rec.No||0)+(rec.Maybe||0);
        const yesPct = total? (rec.Yes*100/total):0;
        const grid = document.createElement('div'); grid.className = 'kpi-grid';
        grid.innerHTML = `
            <div class="kpi"><div class="label">Yes</div><div class="value">${(rec.Yes||0).toLocaleString()}</div></div>
            <div class="kpi"><div class="label">No</div><div class="value">${(rec.No||0).toLocaleString()}</div></div>
            <div class="kpi"><div class="label">Maybe</div><div class="value">${(rec.Maybe||0).toLocaleString()}</div></div>
            <div class="kpi"><div class="label">% Recommend</div><div class="value">${yesPct.toFixed(1)}%</div></div>`;
        c.appendChild(grid);
        const groups = ['Subjects','Environment','Infrastructure','Parent-Teacher','Administrative Support'];
        const table = document.createElement('table'); table.className = 'ranking-table';
        const counts = ratingBy[k]?.[br] || {};
        const rows = groups.map(g=>{
            const grp = counts[g] || {}; const ex = grp.Excellent||0, gd = grp.Good||0, av = grp.Average||0, pr = grp.Poor||0; const tot = ex+gd+av+pr;
            return `<tr><td>${g}</td><td>${ex}</td><td>${gd}</td><td>${av}</td><td>${pr}</td><td>${tot}</td></tr>`;
        }).join('');
        table.innerHTML = `<thead><tr><th>Group</th><th>Excellent</th><th>Good</th><th>Average</th><th>Poor</th><th>Total</th></tr></thead><tbody>${rows}</tbody>`;
        c.appendChild(table);
        area.appendChild(c);
    });
}

function renderBranchRankings(data) {
    const table = document.getElementById('branchRankings');
    const branches = data.rankings.branches.slice(0, 10);
    let html = '<thead><tr><th>Rank</th><th>Branch</th><th>Score</th><th>Responses</th></tr></thead><tbody>';
    branches.forEach((b, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
        const scoreClass = b[1] >= 4.5 ? 'score-excellent' : b[1] >= 3.5 ? 'score-good' : 'score-average';
        html += `<tr><td>${medal}</td><td>${toEnglishLabel(b[0])}</td><td><span class="score-badge ${scoreClass}">${b[1].toFixed(2)}</span></td><td>${b[2]}</td></tr>`;
    });
    table.innerHTML = html + '</tbody>';
}

function renderOrientationRankings(data) {
    const table = document.getElementById('orientationRankings');
    const rankings = data.rankings.orientations || [];
    let html = '<thead><tr><th>Rank</th><th>Orientation</th><th>Score</th><th>Responses</th></tr></thead><tbody>';
    rankings.forEach((item, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const scoreClass = item[1] >= 4.5 ? 'score-excellent' : item[1] >= 3.5 ? 'score-good' : 'score-average';
        html += `<tr><td>${medal}</td><td>${toEnglishLabel(item[0])}</td><td><span class="score-badge ${scoreClass}">${item[1].toFixed(2)}</span></td><td>${item[2]}</td></tr>`;
    });
    table.innerHTML = html + '</tbody>';
}

function renderClassRankings(data) {
    const table = document.getElementById('classRankings');
    const rankings = data.rankings.classes || [];
    let html = '<thead><tr><th>Rank</th><th>Class</th><th>Score</th><th>Responses</th></tr></thead><tbody>';
    rankings.forEach((item, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const scoreClass = item[1] >= 4.5 ? 'score-excellent' : item[1] >= 3.5 ? 'score-good' : 'score-average';
        html += `<tr><td>${medal}</td><td>${toEnglishLabel(item[0])}</td><td><span class="score-badge ${scoreClass}">${item[1].toFixed(2)}</span></td><td>${item[2]}</td></tr>`;
    });
    table.innerHTML = html + '</tbody>';
}

function renderSubjectRankings(data) {
    const table = document.getElementById('subjectRankings');
    const subjects = (data.rankings.subjects || []).slice();
    let html = '<thead><tr><th>Rank</th><th>Subject</th><th>Score</th></tr></thead><tbody>';
    subjects.forEach((item, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const scoreClass = item[1] >= 4.5 ? 'score-excellent' : item[1] >= 3.5 ? 'score-good' : 'score-average';
        html += `<tr><td>${medal}</td><td>${toEnglishLabel(item[0])}</td><td><span class="score-badge ${scoreClass}">${item[1].toFixed(2)}</span></td></tr>`;
    });
    table.innerHTML = html + '</tbody>';
}

function renderBranchChart(data) {
    const ctx = document.getElementById('branchChart').getContext('2d');
    const branches = data.rankings.branches.slice(0, 15);
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: branches.map(b => toEnglishLabel(b[0]).substring(0, 20)),
            datasets: [{
                label: 'Score',
                data: branches.map(b => b[1]),
                backgroundColor: 'rgba(102, 126, 234, 0.8)'
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, max: 5 } }
        }
    });
}

function renderOrientationChart(data) {
    const ctx = document.getElementById('orientationChart').getContext('2d');
    const counts = data.summary.orientations || {};
    const orig = Object.keys(counts);
    const labels = orig.map(l => toEnglishLabel(l));
    const values = orig.map(l => counts[l]);
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: [
                    'rgba(255, 99, 132, 0.8)',
                    'rgba(54, 162, 235, 0.8)',
                    'rgba(255, 206, 86, 0.8)',
                    'rgba(75, 192, 192, 0.8)'
                ]
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, pieValueLabel: { fontSize: 11 } } },
        plugins: [PieValueLabelPlugin]
    });
}

function renderSubjectChart(data) {
    const ctx = document.getElementById('subjectChart').getContext('2d');
    const subjects = data.subject_performance || {};
    const keys = sortSubjects(Object.keys(subjects));
    new Chart(ctx, {
        type: 'radar',
        data: {
            labels: keys.map(toEnglishLabel),
            datasets: [{
                label: 'Score',
                data: keys.map(k => subjects?.[k]?.average),
                backgroundColor: 'rgba(118, 75, 162, 0.2)',
                borderColor: 'rgba(118, 75, 162, 1)',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { r: { beginAtZero: true, max: 5 } }
        }
    });
}

function renderClassChart(data) {
    const ctx = document.getElementById('classDistChart').getContext('2d');
    const counts = data.summary.classes || {};
    const orig = Object.keys(counts);
    const labels = orig.map(l => toEnglishLabel(l));
    const values = orig.map(l => counts[l]);
    new Chart(ctx, {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: [
                    'rgba(76, 175, 80, 0.8)',
                    'rgba(33, 150, 243, 0.8)',
                    'rgba(255, 152, 0, 0.8)',
                    'rgba(156, 39, 176, 0.8)'
                ]
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, pieValueLabel: { fontSize: 11 } } },
        plugins: [PieValueLabelPlugin]
    });
}

function renderEnvironmentChart(data) {
    const ctx = document.getElementById('environmentChart').getContext('2d');
    const env = (data.category_performance && data.category_performance['Environment Quality']) || {};
    const metrics = Object.entries(env).slice(0, 8);
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: metrics.map(m => toEnglishLabel(m[0]).substring(0, 30)),
            datasets: [{
                label: 'Score',
                data: metrics.map(m => m[1].average),
                backgroundColor: 'rgba(76, 175, 80, 0.8)'
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { beginAtZero: true, max: 5 } }
        }
    });
}

function renderInfrastructureChart(data) {
    const ctx = document.getElementById('infrastructureChart').getContext('2d');
    const infra = (data.category_performance && data.category_performance['Infrastructure']) || {};
    const metrics = Object.entries(infra);
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: metrics.map(m => toEnglishLabel(m[0]).substring(0, 30)),
            datasets: [{
                label: 'Score',
                data: metrics.map(m => m[1].average),
                backgroundColor: 'rgba(255, 152, 0, 0.8)'
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { beginAtZero: true, max: 5 } }
        }
    });
}

function renderParentTeacherChart(data) {
    const ctx = document.getElementById('parentTeacherChart').getContext('2d');
    const pt = (data.category_performance && data.category_performance['Parent-Teacher Interaction']) || {};
    const metrics = Object.entries(pt).slice(0, 5);
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: metrics.map(m => toEnglishLabel(m[0]).substring(0, 25)),
            datasets: [{
                label: 'Score',
                data: metrics.map(m => m[1].average),
                backgroundColor: 'rgba(156, 39, 176, 0.8)'
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { beginAtZero: true, max: 5 } }
        }
    });
}

function renderAdminChart(data) {
    const ctx = (typeof resetCanvas === 'function' ? resetCanvas('adminChart') : null) || document.getElementById('adminChart')?.getContext('2d');
    if (!ctx) return;
    const adm = (data.category_performance && data.category_performance['Administrative Support']) || {};
    const metrics = Object.entries(adm).slice(0, 6);
    const labelsFull = metrics.map(m => m[0]);
    const countsByLabel = Object.fromEntries(labelsFull.map(l => {
        const dist = adm[l]?.rating_distribution || {};
        const b = parseRatingBuckets(dist);
        return [l, { Excellent: b.exc, Good: b.good, Average: b.avg, Poor: b.poor, 'Not Applicable': b.na, Unanswered: b.un }];
    }));
    const el = document.getElementById('adminChart');
    if (el && el.parentElement) {
        const h = Math.max(260, labelsFull.length * 44);
        el.parentElement.style.height = h + 'px';
        try { el.height = h; } catch(_) {}
    }
    const labels = labelsFull.map(toEnglishLabel);
    const datasets = RATING_BUCKETS.map(bucket => ({
        label: bucket,
        backgroundColor: RATING_BUCKET_COLORS[bucket],
        barPercentage: 0.9,
        categoryPercentage: 0.9,
        data: labelsFull.map(l => bucketCountGet(countsByLabel?.[l], bucket))
    }));
    new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                avgValueLabel: { countsByLabel, labelsFull, fontSize: 11 },
                stackedValueLabel: { showSegments: true, showTotal: false, fontSize: 10, minPx: 20 },
                tooltip: {
                    callbacks: {
                        title: (tt) => toEnglishLabel(labelsFull[tt[0].dataIndex]),
                        label: (ctx) => {
                            const lab = labelsFull[ctx.dataIndex];
                            const counts = countsByLabel?.[lab] || {};
                            const total = RATING_BUCKETS.reduce((a,b)=> a + bucketCountGet(counts, b), 0);
                            const val = ctx.parsed.x || 0;
                            const pct = total ? `${(val*100/total).toFixed(1)}%` : '';
                            return `${ctx.dataset.label}: ${Number(val).toLocaleString()}${pct ? ` (${pct})` : ''}`;
                        }
                    }
                }
            },
            scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true, ticks: { autoSkip: false, font: { size: 10 } } } }
        },
        plugins: [AvgValueLabelPlugin, StackedValueLabelPlugin]
    });

    try {
        renderAvgBucketsTable('adminTable', labelsFull.map(l => ({
            label: l,
            avg: adm?.[l]?.average ?? null,
            counts: countsByLabel?.[l] || {}
        })));
    } catch (_) {}
}

// =============== New 7-section Dashboard Renderers ===============
function initTabs() {
    const btns = Array.from(document.querySelectorAll('.tab-btn'));
    const sections = {
        exec: document.getElementById('section-exec'),
        academic: document.getElementById('section-academic'),
        env: document.getElementById('section-env'),
        comm: document.getElementById('section-comm'),
        infra: document.getElementById('section-infra'),
        strengths: document.getElementById('section-strengths'),
        branch: document.getElementById('section-branch')
    };
    btns.forEach(b => b.addEventListener('click', () => {
        btns.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        Object.values(sections).forEach(s => s.classList.remove('active'));
        const key = b.dataset.tab;
        sections[key]?.classList.add('active');
    }));
}

function populateFilters(data) {
    const addOptions = (el, items) => {
        el.innerHTML = '<option value="all">All</option>' + items.map(v => `<option value="${v}">${toEnglishLabel(v)}</option>`).join('');
    };
    const branches = Object.keys(data.summary.branches || {});
    const classes = Object.keys(data.summary.classes || {});
    const orientations = Object.keys(data.summary.orientations || {});
    const fb = document.getElementById('filterBranch');
    const fc = document.getElementById('filterClass');
    const fo = document.getElementById('filterOrientation');
    if (fb && fc && fo) {
        addOptions(fb, branches);
        addOptions(fc, classes);
        addOptions(fo, orientations);
    }
}

function renderExecutiveSummary(data) {
    const kpi = document.getElementById('execKpiGrid');
    if (kpi) {
        const overallAvg = (data.summary && data.summary.overall_avg != null) ? data.summary.overall_avg : null;
        const overallPct = overallAvg != null && !isNaN(overallAvg) ? (overallAvg / 5 * 100) : null;
        const acad = data.summary.category_scores?.Academics ?? null;
        const infra = data.summary.category_scores?.Infrastructure ?? null;
        const env = data.summary.category_scores?.Environment ?? null;
        const admin = data.summary.category_scores?.Administration ?? null;
        const fmt = (v) => v==null || isNaN(v) ? '-' : v.toFixed(2);
        const fmtOverallPair = (avg, pct) => {
            if (avg==null || isNaN(avg)) return '-';
            const pctStr = (pct==null || isNaN(pct)) ? '' : ` (${pct.toFixed(1)}%)`;
            return `${avg.toFixed(2)}/5${pctStr}`;
        };
        kpi.innerHTML = `
            <div class="kpi"><div class="label">Total Responses</div><div class="value">${(data.summary.total_responses||0).toLocaleString()}</div></div>
            <div class="kpi"><div class="label">Overall Satisfaction</div><div class="value">${fmtOverallPair(overallAvg, overallPct)}</div></div>
            <div class="kpi"><div class="label">Average Academic Rating</div><div class="value">${fmt(acad)}</div></div>
            <div class="kpi"><div class="label">Average Environment Rating</div><div class="value">${fmt(env)}</div></div>
            <div class="kpi"><div class="label">Average Infrastructure Rating</div><div class="value">${fmt(infra)}</div></div>
            <div class="kpi"><div class="label">Average Administration Rating</div><div class="value">${fmt(admin)}</div></div>
        `;
    }

    try {
        const counts = data.overall_rating_counts || {};
        const order = ['Overall Satisfaction','Academics','Environment','Infrastructure','Administration'];
        const labels = order.filter(k => counts[k]);
        const countsByLabel = Object.fromEntries(labels.map(l => [l, counts[l]]));
        const el = document.getElementById('summaryCategoryChart');
        if (el && el.parentElement) {
            const h = Math.max(220, labels.length * 52);
            el.parentElement.style.height = h + 'px';
            try { el.height = h; } catch(_) {}
        }
        if (labels.length) renderBucketStackedChart('summaryCategoryChart', labels, countsByLabel, { indexAxis: 'y', showAvgLabel: true });

        const avgMap = {
            'Overall Satisfaction': data.summary?.overall_avg ?? null,
            'Academics': data.summary?.category_scores?.Academics ?? null,
            'Environment': data.summary?.category_scores?.Environment ?? null,
            'Infrastructure': data.summary?.category_scores?.Infrastructure ?? null,
            'Administration': data.summary?.category_scores?.Administration ?? null,
        };
        renderAvgBucketsTable('summaryCategoryTable', labels.map(l => ({ label: l, avg: avgMap[l], counts: countsByLabel[l] })));
    } catch (e) { console.error(e); }

    // Render Overall Satisfaction chart (Academics, Administration, Transport)
    try {
        const overallSat = data.overall_satisfaction || {};
        const satKeys = Object.keys(overallSat).sort();
        const satCtx = (typeof resetCanvas === 'function' ? resetCanvas('overallSatisfactionChart') : null) || document.getElementById('overallSatisfactionChart')?.getContext('2d');
        if (satCtx && satKeys.length) {
            const el = document.getElementById('overallSatisfactionChart');
            if (el && el.parentElement) {
                const h = Math.max(220, satKeys.length * 52);
                el.parentElement.style.height = h + 'px';
                try { el.height = h; } catch(_) {}
            }
            const countsByLabel = Object.fromEntries(satKeys.map(k => [k, overallSat[k]?.rating_distribution || {}]));
            renderBucketStackedChart('overallSatisfactionChart', satKeys, countsByLabel, { indexAxis: 'y', showAvgLabel: true });
            
            renderAvgBucketsTable('overallSatisfactionTable', satKeys.map(k => ({
                label: k,
                avg: overallSat[k]?.average ?? null,
                counts: overallSat[k]?.rating_distribution || {}
            })));
        }
    } catch (e) { console.error('Error rendering overall satisfaction:', e); }

    // Skip recommendation and segment rendering (data not available)

    const brCtx = (typeof resetCanvas === 'function' ? resetCanvas('branchOverallChart') : null) || document.getElementById('branchOverallChart')?.getContext('2d');
    if (brCtx && data.rankings?.branches) {
        const arr = (data.rankings.branches || []).slice();
        const parent = document.getElementById('branchOverallChart')?.parentElement;
        if (parent) parent.style.height = Math.max(400, arr.length * 24) + 'px';
        const colorFor = (v) => {
            const x = Math.max(0, Math.min(1, (v || 0) / 5));
            if (x < 0.5) {
                const t = x / 0.5;
                const r = Math.round(229 + (251-229)*t);
                const g = Math.round(57 + (140-57)*t);
                const b = Math.round(53 + (0-53)*t);
                return `rgb(${r},${g},${b})`;
            } else {
                const t = (x-0.5)/0.5;
                const r = Math.round(251 + (67-251)*t);
                const g = Math.round(140 + (160-140)*t);
                const b = Math.round(0 + (71-0)*t);
                return `rgb(${r},${g},${b})`;
            }
        };
        new Chart(brCtx, {
            type: 'bar',
            data: { labels: arr.map(x => toEnglishLabel(x[0])), datasets: [{ label: 'Overall', data: arr.map(x => x[1]), backgroundColor: arr.map(x => colorFor(x[1])) }] },
            options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { beginAtZero: true, max: 5 } } }
        });
    }
}

function renderAcademicSection(data) {
    console.log('📚 renderAcademicSection called, CURRENT_BRANCH:', CURRENT_BRANCH);
    console.log('📚 Academic filters - Class:', CURRENT_ACADEMIC_CLASS, 'Orientation:', CURRENT_ACADEMIC_ORIENTATION);
    console.log('📚 data.subject_performance exists:', !!data.subject_performance);
    console.log('📚 data.subject_performance keys:', Object.keys(data.subject_performance || {}));

    // Apply Class/Orientation filters to subject performance
    let subjects = data.subject_performance || {};
    console.log('📚 Initial subjects count:', Object.keys(subjects).length);
    
    // Check if we need to use filtered data
    if (CURRENT_ACADEMIC_CLASS || CURRENT_ACADEMIC_ORIENTATION) {
        let filterKey = '';
        if (CURRENT_BRANCH) {
            // Branch-specific filtering
            const branchFilters = data.branch_subject_performance_by?.[CURRENT_BRANCH] || {};
            if (CURRENT_ACADEMIC_CLASS && CURRENT_ACADEMIC_ORIENTATION) {
                subjects = branchFilters.pair?.[CURRENT_ACADEMIC_CLASS]?.[CURRENT_ACADEMIC_ORIENTATION] || {};
            } else if (CURRENT_ACADEMIC_CLASS) {
                subjects = branchFilters.class?.[CURRENT_ACADEMIC_CLASS] || {};
            } else if (CURRENT_ACADEMIC_ORIENTATION) {
                subjects = branchFilters.orientation?.[CURRENT_ACADEMIC_ORIENTATION] || {};
            }
        } else if (CURRENT_STATE) {
            // State-specific filtering
            const stateFilters = data.state_subject_performance_by?.[CURRENT_STATE] || {};
            if (CURRENT_ACADEMIC_CLASS && CURRENT_ACADEMIC_ORIENTATION) {
                subjects = stateFilters.pair?.[CURRENT_ACADEMIC_CLASS]?.[CURRENT_ACADEMIC_ORIENTATION] || {};
            } else if (CURRENT_ACADEMIC_CLASS) {
                subjects = stateFilters.class?.[CURRENT_ACADEMIC_CLASS] || {};
            } else if (CURRENT_ACADEMIC_ORIENTATION) {
                subjects = stateFilters.orientation?.[CURRENT_ACADEMIC_ORIENTATION] || {};
            }
        } else {
            // Overall filtering
            const overallFilters = data.subject_performance_by || {};
            if (CURRENT_ACADEMIC_CLASS && CURRENT_ACADEMIC_ORIENTATION) {
                subjects = overallFilters.pair?.[CURRENT_ACADEMIC_CLASS]?.[CURRENT_ACADEMIC_ORIENTATION] || {};
            } else if (CURRENT_ACADEMIC_CLASS) {
                subjects = overallFilters.class?.[CURRENT_ACADEMIC_CLASS] || {};
            } else if (CURRENT_ACADEMIC_ORIENTATION) {
                subjects = overallFilters.orientation?.[CURRENT_ACADEMIC_ORIENTATION] || {};
            }
        }
    }

    const keys = sortSubjects(Object.keys(subjects));
    console.log('📚 Subjects (after filters):', keys);
    // Subject-wise stacked distribution - use filtered subjects
    const subj = subjects;
    const subjectsAll = Object.keys(subj);
    const subjectsFiltered = subjectsAll.filter(name => {
        const dist = subj[name]?.rating_distribution || {};
        let exc=0, good=0, avg=0, poor=0;
        for (const [k, v] of Object.entries(dist)) {
            const raw = String(k);
            const low = raw.toLowerCase();
            const lowNorm = low.replace(/[\s./-]/g, '');
            const val = v || 0;
            const isAvg = low.includes('average') || low.includes('satisfactory');
            const isNeed = low.includes('need') || low.includes('needs') || low.includes('improve');
            const isNA = low.includes('not applicable') || low.includes('பொருந்தாது') || low === 'na' || low === 'n/a' || low === 'n.a' || lowNorm === 'notapplicable';
            const isUnanswered = low.includes('unanswered') || low === '';
            if (isNA || isUnanswered) continue;
            if (low.includes('excellent') || raw.trim()==='5' || low.includes('very good')) exc += val;
            else if (low.includes('good') || raw.trim()==='4') good += val;
            else if (isAvg || raw.trim()==='3') avg += val;
            else if (low.includes('poor') || isNeed || raw.trim()==='2' || raw.trim()==='1') poor += val;
            else {
                const num = parseInt(raw, 10);
                if (num === 5) exc += val; else if (num === 4) good += val; else if (num === 3) avg += val; else if (num === 2 || num === 1) poor += val;
            }
        }
        return (exc + good + avg + poor) > 0;
    });
    // Sort subjects in the specified order
    const subjectsSorted = sortSubjects(subjectsFiltered);
    const displaySubjects = subjectsSorted.map(toEnglishLabel);
    // Determine total respondents (overall or branch)
    const totalResp = (data.summary?.total_responses)
        ?? (data.summary_all?.total_responses)
        ?? subjectsSorted.reduce((mx, s) => {
            const dist = subj[s]?.rating_distribution || {};
            const sum = Object.values(dist).reduce((a,b)=>a+(b||0),0);
            return Math.max(mx, sum);
        }, 0);
    const groups = ['Excellent','Good','Average','Poor','Not Applicable','Unanswered'];
    const colorMap = {
        Excellent: '#4caf50',
        Good: '#2196f3',
        Average: '#ff9800',
        Poor: '#e53935',
        'Not Applicable': '#90a4ae',
        Unanswered: '#cfd8dc'
    };
    const countsBySubject = Object.fromEntries(subjectsSorted.map(s => {
        const dist = subj[s]?.rating_distribution || {};
        let exc=0, good=0, avg=0, poor=0, na=0, unanswered=0;
        for (const [k, v] of Object.entries(dist)) {
            const raw = String(k);
            const low = raw.toLowerCase();
            const lowNorm = low.replace(/[\s./-]/g, '');
            const val = v || 0;
            const isAvg = low.includes('average') || low.includes('satisfactory');
            const isNeed = low.includes('need') || low.includes('needs') || low.includes('improve');
            const isNA = low.includes('not applicable') || low.includes('பொருந்தாது') || low === 'na' || low === 'n/a' || low === 'n.a' || lowNorm === 'notapplicable';
            const isUnanswered = low.includes('unanswered') || low === '';
            if (low.includes('excellent') || raw.trim()==='5' || low.includes('very good')) exc += val;
            else if (low.includes('good') || raw.trim()==='4') good += val;
            else if (isAvg || raw.trim()==='3') avg += val;
            else if (low.includes('poor') || isNeed || raw.trim()==='2' || raw.trim()==='1') poor += val;
            else if (isNA) na += val;
            else if (isUnanswered) unanswered += val;
            else {
                const num = parseInt(raw, 10);
                if (num === 5) exc += val;
                else if (num === 4) good += val;
                else if (num === 3) avg += val;
                else if (num === 2 || num === 1) poor += val;
            }
        }
        return [s, { Excellent: exc, Good: good, Average: avg, Poor: poor, 'Not Applicable': na, Unanswered: unanswered }];
    }));
    const stackData = groups.map(g => ({
        label: g,
        backgroundColor: colorMap[g],
        barPercentage: 0.9,
        categoryPercentage: 0.9,
        data: subjectsSorted.map(s => bucketCountGet(countsBySubject[s], g))
    }));
    // Dynamic height + horizontal bars to avoid label/legend overlap
    const scEl = document.getElementById('subjectStackedChart');
    const scCtx = (typeof resetCanvas === 'function' ? resetCanvas('subjectStackedChart') : null) || scEl?.getContext('2d');
    if (scEl && scEl.parentElement) {
        const h = Math.max(260, subjectsSorted.length * 26); // increase per-row height
        scEl.parentElement.style.height = h + 'px';
        scEl.style.height = h + 'px';
        try { scEl.height = h; } catch(_) {}
    }
    if (scCtx) {
        const truncate = (s, n=32) => (s && s.length>n) ? (s.slice(0,n-1)+'…') : s;
        const labelsFull = displaySubjects.slice();
        const labelsTrunc = labelsFull.map(s => truncate(s));
        new Chart(scCtx, {
            type: 'bar',
            data: { labels: labelsTrunc, datasets: stackData },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                layout: { padding: { left: 10, right: 34, bottom: 6 } },
                plugins: {
                    legend: { position: 'bottom' },
                    avgValueLabel: { countsByLabel: countsBySubject, labelsFull: subjectsSorted, fontSize: 11 },
                    stackedValueLabel: { showSegments: true, showTotal: false, fontSize: 10, minPx: 20 },
                    tooltip: {
                        callbacks: {
                            title: (tt) => {
                                const idx = tt[0].dataIndex;
                                const key = subjectsSorted[idx];
                                const avg = avgFromBucketCounts(countsBySubject?.[key] || {});
                                const avgStr = (avg == null || isNaN(avg)) ? '-' : `${avg.toFixed(2)}/5 (${((avg/5)*100).toFixed(1)}%)`;
                                const total = RATING_BUCKETS.reduce((a,b)=> a + bucketCountGet(countsBySubject?.[key] || {}, b), 0);
                                return `${labelsFull[idx]} — Avg ${avgStr} • n=${total.toLocaleString()}`;
                            },
                            label: (ctx) => {
                                const val = ctx.parsed.x || 0;
                                const idx = ctx.dataIndex;
                                const rawName = subjectsSorted[idx];
                                const dist = subj[rawName]?.rating_distribution || {};
                                let exc=0, good=0, avg=0, poor=0, na=0, un=0;
                                for (const [k, v] of Object.entries(dist)) {
                                    const raw = String(k);
                                    const low = raw.toLowerCase();
                                    const lowNorm = low.replace(/[\s./-]/g, '');
                                    const valv = v || 0;
                                    const isAvg = low.includes('average') || low.includes('satisfactory');
                                    const isNeed = low.includes('need') || low.includes('needs') || low.includes('improve');
                                    const isNA = low.includes('not applicable') || low.includes('பொருந்தாது') || low === 'na' || low === 'n/a' || low === 'n.a' || lowNorm === 'notapplicable';
                                    const isUnanswered = low.includes('unanswered') || low === '';
                                    if (low.includes('excellent') || raw.trim()==='5' || low.includes('very good')) exc += valv;
                                    else if (low.includes('good') || raw.trim()==='4') good += valv;
                                    else if (isAvg || raw.trim()==='3') avg += valv;
                                    else if (low.includes('poor') || isNeed || raw.trim()==='2' || raw.trim()==='1') poor += valv;
                                    else if (isNA) na += valv;
                                    else if (isUnanswered) un += valv;
                                    else {
                                        const num = parseInt(raw, 10);
                                        if (num === 5) exc += valv; else if (num === 4) good += valv; else if (num === 3) avg += valv; else if (num === 2 || num === 1) poor += valv;
                                    }
                                }
                                const totalS = exc + good + avg + poor + na + un;
                                const pct = totalS ? ((val*100/totalS).toFixed(1)+'%') : '';
                                return `${ctx.dataset.label}: ${val.toLocaleString()}${pct? ' ('+pct+')':''}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { stacked: true, beginAtZero: true },
                    y: { stacked: true, ticks: { autoSkip: false, font: { size: 10 } } }
                }
            },
            plugins: [AvgValueLabelPlugin, StackedValueLabelPlugin]
        });
    }
    // Subject distribution counts table
    const table = document.getElementById('subjectCountsTable');
    if (table) {
        // Ensure table wraps and doesn't force overflow
        table.style.tableLayout = 'fixed';
        table.style.width = '100%';
        table.style.wordBreak = 'break-word';
        table.style.whiteSpace = 'normal';
        const header = '<thead><tr><th>Subject</th><th>Excellent</th><th>Good</th><th>Average</th><th>Poor</th><th>Not Applicable</th><th>Unanswered</th><th>Total Respondents</th></tr></thead>';
        const rows = subjectsSorted.map(name => {
            const dist = subj[name]?.rating_distribution || {};
            let exc = 0, good = 0, avg = 0, poor = 0, na = 0, unanswered = 0;
            for (const [k, v] of Object.entries(dist)) {
                const raw = String(k);
                const low = raw.toLowerCase();
                const lowNorm = low.replace(/[\s./-]/g, '');
                const val = v || 0;
                const isAvg = low.includes('average') || low.includes('satisfactory');
                const isNeed = low.includes('need') || low.includes('needs') || low.includes('improve');
                const isNA = low.includes('not applicable') || low.includes('பொருந்தாது') || low === 'na' || low === 'n/a' || low === 'n.a' || lowNorm === 'notapplicable';
                const isUnanswered = low.includes('unanswered') || low === '';
                if (low.includes('excellent') || raw.trim()==='5' || low.includes('very good')) exc += val;
                else if (low.includes('good') || raw.trim()==='4') good += val;
                else if (isAvg || raw.trim()==='3') avg += val;
                else if (low.includes('poor') || isNeed || raw.trim()==='2' || raw.trim()==='1') poor += val;
                else if (isNA) na += val;
                else if (isUnanswered) unanswered += val;
                else {
                    const num = parseInt(raw, 10);
                    if (num === 5) exc += val;
                    else if (num === 4) good += val;
                    else if (num === 3) avg += val;
                    else if (num === 2 || num === 1) poor += val;
                }
            }
            const totalRatedNA = exc + good + avg + poor + na;
            const total = totalRatedNA + unanswered;
            const pct = (v) => total ? ` (${(v*100/total).toFixed(1)}%)` : '';
            if (!totalRatedNA) return null;
            return `<tr><td>${toEnglishLabel(name)}</td><td>${exc.toLocaleString()}${pct(exc)}</td><td>${good.toLocaleString()}${pct(good)}</td><td>${avg.toLocaleString()}${pct(avg)}</td><td>${poor.toLocaleString()}${pct(poor)}</td><td>${na.toLocaleString()}${pct(na)}</td><td>${unanswered.toLocaleString()}${pct(unanswered)}</td><td>${total.toLocaleString()}</td></tr>`;
        }).filter(Boolean).join('');
        table.innerHTML = header + `<tbody>${rows}</tbody>`;
    }

    console.log('📚 About to render Program Excellence...');
    // Render segment-wise subject performance side-by-side (All branches or selected branch)
    try { renderAcademicSegmentBlocks(); } catch (e) { console.error('Error in renderAcademicSegmentBlocks:', e); }
    try { 
        console.log('📚 Calling renderProgramExcellence with data.program_excellence:', Object.keys(data.program_excellence || {}));
        renderProgramExcellence(data); 
    } catch (e) { 
        console.error('Error in renderProgramExcellence:', e); 
    }
    console.log('📚 renderAcademicSection completed');
}

function renderProgramExcellence(data) {
    console.log('🎯 renderProgramExcellence called');
    const pe = data.program_excellence || {};
    const keys = Object.keys(pe);
    console.log('🎯 Program excellence keys:', keys);
    console.log('🎯 Program excellence data:', pe);
    const canvas = document.getElementById('programExcellenceChart');
    const table = document.getElementById('programExcellenceTable');
    console.log('🎯 Canvas element found:', !!canvas);
    console.log('🎯 Table element found:', !!table);
    const wrap = canvas ? canvas.closest('.chart-container') : null;
    if (wrap) wrap.style.display = keys.length ? '' : 'none';
    if (!keys.length) {
        console.log('🎯 No program excellence keys, returning early');
        if (table) table.innerHTML = '';
        return;
    }
    console.log('🎯 Proceeding to render chart and table...');

    if (canvas && canvas.parentElement) {
        const h = Math.max(260, keys.length * 52);
        canvas.parentElement.style.height = h + 'px';
        try { canvas.height = h; } catch(_) {}
    }

    const countsByLabel = Object.fromEntries(keys.map(k => [k, pe[k]?.rating_distribution || {}]));
    renderBucketStackedChart('programExcellenceChart', keys, countsByLabel, { indexAxis: 'y', showAvgLabel: true });

    if (table) {
        table.style.tableLayout = 'fixed';
        table.style.width = '100%';
        table.style.wordBreak = 'break-word';
        table.style.whiteSpace = 'normal';
        const header = '<thead><tr><th>Question</th><th>Avg</th><th>Excellent</th><th>Good</th><th>Average</th><th>Poor</th><th>Not Applicable</th><th>Unanswered</th><th>Total</th></tr></thead>';
        const rows = keys.map(k => {
            const c = pe[k]?.rating_distribution || {};
            const exc = bucketCountGet(c,'Excellent');
            const good = bucketCountGet(c,'Good');
            const avg = bucketCountGet(c,'Average');
            const poor = bucketCountGet(c,'Poor');
            const na = bucketCountGet(c,'Not Applicable');
            const un = bucketCountGet(c,'Unanswered');
            const total = exc + good + avg + poor + na + un;
            const pct = (v) => total ? ` (${(v*100/total).toFixed(1)}%)` : '';
            const avgScore = (pe[k]?.average != null && !isNaN(pe[k]?.average)) ? Number(pe[k].average) : avgFromBucketCounts(c);
            return `<tr><td>${toEnglishLabel(k)}</td><td>${fmtAvgWithPct(avgScore)}</td><td>${exc.toLocaleString()}${pct(exc)}</td><td>${good.toLocaleString()}${pct(good)}</td><td>${avg.toLocaleString()}${pct(avg)}</td><td>${poor.toLocaleString()}${pct(poor)}</td><td>${na.toLocaleString()}${pct(na)}</td><td>${un.toLocaleString()}${pct(un)}</td><td>${total.toLocaleString()}</td></tr>`;
        }).join('');
        table.innerHTML = header + `<tbody>${rows}</tbody>`;
    }
}

// Academic: segment-wise side-by-side cards with stacked chart and counts
function renderAcademicSegmentBlocks() {
    const sec = document.getElementById('section-academic');
    if (!sec) return;
    const content = sec.querySelector('.section-content') || sec;
    
    // Check if segment data exists
    const order = ['Pre Primary','Primary','High School'];
    let segMap;
    if (CURRENT_BRANCH) {
        segMap = RAW_DATA?.branch_segment_subject_performance?.[CURRENT_BRANCH] || {};
    } else {
        segMap = RAW_DATA?.segment_subject_performance || {};
    }
    const segs = order.filter(s => segMap[s] && Object.keys(segMap[s]).length);
    
    // Find or create container
    let container = content.querySelector('.acad-seg-container');
    
    // If no segment data, hide the container
    if (!segs.length) {
        if (container) {
            container.style.display = 'none';
        }
        return;
    }
    
    // If we have data, ensure container exists and is visible
    if (!container) {
        container = document.createElement('div');
        container.className = 'chart-container acad-seg-container';
        const h = document.createElement('h2');
        h.textContent = 'Subject-wise Performance by Segment';
        container.appendChild(h);
        content.insertBefore(container, content.firstChild);
    } else {
        container.style.display = '';
        // reset contents but keep container node at top
        container.innerHTML = '';
        const h = document.createElement('h2');
        h.textContent = 'Subject-wise Performance by Segment';
        container.appendChild(h);
    }
    
    let area = container.querySelector('.acad-seg-area');
    if (!area) {
        area = document.createElement('div');
        area.className = 'acad-seg-area';
        area.style.display = 'grid';
        area.style.gridTemplateColumns = '1fr';
        area.style.gap = '14px';
        area.style.alignItems = 'start';
        area.style.margin = '10px 0 18px';
        container.appendChild(area);
    } else {
        area.innerHTML = '';
        area.style.gridTemplateColumns = '1fr';
    }

    segs.forEach((seg, idx) => {
        const subjMap = segMap[seg] || {};
        const subjectsFiltered = Object.keys(subjMap).filter(n => {
            const dist = subjMap[n]?.rating_distribution || {};
            let exc=0, good=0, avg=0, poor=0;
            for (const [k, v] of Object.entries(dist)) {
                const raw = String(k);
                const low = raw.toLowerCase();
                const lowNorm = low.replace(/[\s./-]/g,'');
                const val = v || 0;
                const isAvg = low.includes('average') || low.includes('satisfactory');
                const isNeed = low.includes('need') || low.includes('improve');
                const isNA = low.includes('not applicable') || low.includes('பொருந்தாது') || low === 'na' || low === 'n/a' || low === 'n.a' || lowNorm === 'notapplicable';
                const isUnanswered = low.includes('unanswered') || low === '';
                if (isNA || isUnanswered) continue;
                if (low.includes('excellent') || raw.trim()==='5' || low.includes('very good')) exc += val;
                else if (low.includes('good') || raw.trim()==='4') good += val;
                else if (isAvg || raw.trim()==='3') avg += val;
                else if (low.includes('poor') || isNeed || raw.trim()==='2' || raw.trim()==='1') poor += val;
                else {
                    const num = parseInt(raw, 10);
                    if (num === 5) exc += val; else if (num === 4) good += val; else if (num === 3) avg += val; else if (num === 2 || num === 1) poor += val;
                }
            }
            return (exc + good + avg + poor) > 0;
        });
        // Sort subjects in the specified order
        const subjects = sortSubjects(subjectsFiltered);
        if (!subjects.length) return;

        const c = card(`${seg} — Subject Performance`);
        // KPIs
        const avgs = subjects.map(n => subjMap[n]?.average || null).filter(v => v!=null && !isNaN(v));
        const overall = avgs.length ? (avgs.reduce((a,b)=>a+b,0)/avgs.length) : null;
        // Responses per segment (branch-specific or aggregated across branches)
        let responses = 0;
        if (CURRENT_BRANCH) {
            responses = (RAW_DATA?.branch_segment_performance?.[CURRENT_BRANCH]?.[seg]?.count) || 0;
        } else {
            const perfByBranch = RAW_DATA?.branch_segment_performance || {};
            for (const br of Object.keys(perfByBranch)) {
                const p = perfByBranch[br]?.[seg];
                if (p && typeof p.count === 'number') responses += (p.count || 0);
            }
        }
        const kpi = document.createElement('div'); kpi.className = 'kpi-grid';
        kpi.innerHTML = `
            <div class="kpi"><div class="label">Responses</div><div class="value">${(responses||0).toLocaleString()}</div></div>
            <div class="kpi"><div class="label">Subjects</div><div class="value">${subjects.length}</div></div>
            <div class="kpi"><div class="label">Overall Subject Avg</div><div class="value">${overall!=null&&!isNaN(overall)?overall.toFixed(2):'-'}</div></div>`;
        c.appendChild(kpi);

        // Row container (only distribution table; histogram removed)
        const row = document.createElement('div'); row.className = 'chart-row';
        row.style.display = 'block';

        const tableWrap = document.createElement('div'); tableWrap.className = 'side-kpi';
        tableWrap.style.alignSelf = 'start';
        tableWrap.style.overflow = 'visible';
        tableWrap.style.minWidth = '360px';
        tableWrap.style.width = '100%';
        const table = document.createElement('table'); table.className = 'ranking-table'; table.id = `acadSegTable_${idx}`;
        table.style.tableLayout = 'fixed';
        table.style.width = '100%';
        table.style.wordBreak = 'break-word';
        table.style.whiteSpace = 'normal';
        tableWrap.appendChild(table);
        row.appendChild(tableWrap);
        c.appendChild(row);
        area.appendChild(c);

        // Histogram removed for segment cards; keep only table

        // Table rows (percentages are over segment responses; include Unanswered so columns add up to 100%)
        const header = '<thead><tr><th>Subject</th><th>Excellent</th><th>Good</th><th>Average</th><th>Poor</th><th>Not Applicable</th><th>Unanswered</th><th>Total Respondents</th></tr></thead>';
        const rows = subjects.map(name => {
            const dist = subjMap[name]?.rating_distribution || {};
            let exc = 0, good = 0, avg = 0, poor = 0, na = 0, un = 0;
            for (const [k, v] of Object.entries(dist)) {
                const raw = String(k);
                const low = raw.toLowerCase();
                const lowNorm = low.replace(/[\s./-]/g, '');
                const val = v || 0;
                const isAvg = low.includes('average') || low.includes('satisfactory');
                const isNeed = low.includes('need') || low.includes('improve');
                const isNA = low.includes('not applicable') || low.includes('பொருந்தாது') || low === 'na' || low === 'n/a' || low === 'n.a' || lowNorm === 'notapplicable';
                const isUnanswered = low.includes('unanswered') || low === '';
                if (low.includes('excellent') || raw.trim()==='5' || low.includes('very good')) exc += val;
                else if (low.includes('good') || raw.trim()==='4') good += val;
                else if (isAvg || raw.trim()==='3') avg += val;
                else if (low.includes('poor') || isNeed || raw.trim()==='2' || raw.trim()==='1') poor += val;
                else if (isNA) na += val;
                else if (isUnanswered) un += val;
                else {
                    const num = parseInt(raw, 10);
                    if (num === 5) exc += val; else if (num === 4) good += val; else if (num === 3) avg += val; else if (num === 2 || num === 1) poor += val;
                }
            }
            const total = exc + good + avg + poor + na + un;
            const pct = (v) => total ? ` (${(v*100/total).toFixed(1)}%)` : '';
            return `<tr>
                <td>${toEnglishLabel(name)}</td>
                <td>${exc.toLocaleString()}${pct(exc)}</td>
                <td>${good.toLocaleString()}${pct(good)}</td>
                <td>${avg.toLocaleString()}${pct(avg)}</td>
                <td>${poor.toLocaleString()}${pct(poor)}</td>
                <td>${na.toLocaleString()}${pct(na)}</td>
                <td>${un.toLocaleString()}${pct(un)}</td>
                <td>${total.toLocaleString()}</td>
            </tr>`;
        }).join('');
        table.innerHTML = header + `<tbody>${rows}</tbody>`;
    });
}

function renderEnvironmentSection(data) {
    console.log('🌳 renderEnvironmentSection called, CURRENT_BRANCH:', CURRENT_BRANCH);
    // Use Environment Quality detailed metrics - use the viewData directly (already filtered by deriveViewData)
    let envCat = (data.category_performance && data.category_performance['Environment Quality']) || {};
    console.log('🌳 Environment categories:', Object.keys(envCat));
    const rawLabels = Object.keys(envCat);
    const displayLabels = rawLabels.map(toEnglishLabel);

    // Total respondents (All branches or selected branch view)
    const totalResp = (data.summary?.total_responses) ?? (data.summary_all?.total_responses) ?? 0;

    // Build stacked counts (Excellent/Good/Average/Poor/Not Applicable/Unanswered)
    const groups = ['Excellent','Good','Average','Poor','Not Applicable','Unanswered'];
    const colorMap = {
        Excellent: '#4caf50',
        Good: '#2196f3',
        Average: '#ff9800',
        Poor: '#e53935',
        'Not Applicable': '#90a4ae',
        Unanswered: '#cfd8dc'
    };
    const parseBuckets = (distObj) => {
        let exc=0, good=0, avg=0, poor=0, na=0, un=0;
        for (const [k, v] of Object.entries(distObj||{})) {
            const raw = String(k);
            const low = raw.toLowerCase();
            const lowNorm = low.replace(/[\s./-]/g, '');
            const val = v || 0;
            const isAvg = low.includes('average') || low.includes('satisfactory') || low.includes('சராசரி') || low.includes('திருப்தி');
            const isNeed = low.includes('need') || low.includes('needs') || low.includes('improve') || low.includes('முன்னேற்றம்') || low.includes('மோசம்');
            const isNA = low.includes('not applicable') || low.includes('பொருந்தாது') || low === 'na' || low === 'n/a' || low === 'n.a' || lowNorm === 'notapplicable';
            const isUnanswered = low.includes('unanswered') || low === '';
            if (low.includes('excellent') || raw.trim()==='5' || low.includes('very good')) exc += val;
            else if (low.includes('good') || raw.trim()==='4') good += val;
            else if (isAvg || raw.trim()==='3') avg += val;
            else if (low.includes('poor') || isNeed || raw.trim()==='2' || raw.trim()==='1') poor += val;
            else if (isNA) na += val;
            else if (isUnanswered) un += val;
            else {
                const num = parseInt(raw, 10);
                if (num === 5) exc += val; else if (num === 4) good += val; else if (num === 3) avg += val; else if (num === 2 || num === 1) poor += val;
            }
        }
        return { exc, good, avg, poor, na, un };
    };

    const countsByEnv = Object.fromEntries(rawLabels.map(raw => {
        const dist = envCat[raw]?.rating_distribution || {};
        const { exc, good, avg, poor, na, un } = parseBuckets(dist);
        return [raw, { Excellent: exc, Good: good, Average: avg, Poor: poor, 'Not Applicable': na, Unanswered: un }];
    }));
    const datasets = groups.map(g => ({
        label: g,
        backgroundColor: colorMap[g],
        barPercentage: 0.9,
        categoryPercentage: 0.9,
        data: rawLabels.map(raw => bucketCountGet(countsByEnv[raw], g))
    }));

    // Render stacked counts chart
    const ecEl = document.getElementById('envRatingsChart');
    const ec = (typeof resetCanvas === 'function' ? resetCanvas('envRatingsChart') : null) || ecEl?.getContext('2d');
    if (ecEl && ecEl.parentElement) {
        const h = Math.max(240, displayLabels.length * 26);
        ecEl.parentElement.style.height = h + 'px';
        ecEl.style.height = h + 'px';
        try { ecEl.height = h; } catch(_) {}
    }
    if (ec) {
        new Chart(ec, {
            type: 'bar',
            data: { labels: displayLabels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                layout: { padding: { right: 34 } },
                plugins: {
                    legend: { position: 'bottom' },
                    avgValueLabel: { countsByLabel: countsByEnv, labelsFull: rawLabels, fontSize: 11 },
                    stackedValueLabel: { showSegments: true, showTotal: false, fontSize: 10, minPx: 20 },
                    tooltip: {
                        callbacks: {
                            title: (tt) => {
                                const idx = tt[0].dataIndex;
                                const key = rawLabels[idx];
                                const avg = avgFromBucketCounts(countsByEnv?.[key] || {});
                                const avgStr = (avg == null || isNaN(avg)) ? '-' : `${avg.toFixed(2)}/5 (${((avg/5)*100).toFixed(1)}%)`;
                                const total = RATING_BUCKETS.reduce((a,b)=> a + bucketCountGet(countsByEnv?.[key] || {}, b), 0);
                                return `${displayLabels[idx]} — Avg ${avgStr} • n=${total.toLocaleString()}`;
                            },
                            label: (ctx) => {
                                const val = ctx.parsed.x || 0;
                                const raw = rawLabels[ctx.dataIndex];
                                const dist = envCat[raw]?.rating_distribution || {};
                                const { exc, good, avg, poor, na, un } = parseBuckets(dist);
                                const total = exc + good + avg + poor + na + un;
                                const pct = total ? ((val*100/total).toFixed(1)+'%') : '';
                                return `${ctx.dataset.label}: ${val.toLocaleString()}${pct? ' ('+pct+')':''}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { stacked: true, beginAtZero: true, max: totalResp || undefined },
                    y: { stacked: true, ticks: { autoSkip: false, font: { size: 10 } } }
                }
            },
            plugins: [AvgValueLabelPlugin, StackedValueLabelPlugin]
        });
    }

    // KPIs: Safety and Hygiene from Environment Quality averages (fallback to Infrastructure for hygiene if needed)
    let safety = null, hygiene = null;
    for (const [k, v] of Object.entries(envCat)) {
        const low = String(k).toLowerCase();
        if (safety == null && low.includes('safety')) safety = v?.average ?? safety;
        if (hygiene == null && (low.includes('hygiene') || low.includes('clean'))) hygiene = v?.average ?? hygiene;
    }
    if (hygiene == null) {
        const infra = (data.category_performance && data.category_performance['Infrastructure']) || {};
        for (const [k,v] of Object.entries(infra)) {
            const low = String(k).toLowerCase();
            if (low.includes('hygiene') || low.includes('clean')) { hygiene = v?.average ?? hygiene; }
        }
        if (hygiene == null) {
            const vals = Object.values(infra).map(o => o?.average).filter(x => x!=null && !isNaN(x));
            if (vals.length) hygiene = vals.reduce((a,b)=>a+b,0)/vals.length;
        }
    }
    if (safety == null) {
        // Fallback to overall average of Environment Quality if explicit Safety not found
        const vals = Object.values(envCat).map(o => o?.average).filter(x => x!=null && !isNaN(x));
        if (vals.length) safety = vals.reduce((a,b)=>a+b,0)/vals.length;
    }
    const setKpi = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = (val==null || isNaN(val)) ? '-' : Number(val).toFixed(2); };
    setKpi('safetyKpi', safety);
    setKpi('hygieneKpi', hygiene);

    // Environment counts table with percentages (over answered per item)
    const table = document.getElementById('envCountsTable');
    if (table) {
        table.style.tableLayout = 'fixed';
        table.style.width = '100%';
        table.style.wordBreak = 'break-word';
        table.style.whiteSpace = 'normal';
        const header = '<thead><tr><th>Item</th><th>Excellent</th><th>Good</th><th>Average</th><th>Poor</th><th>Not Applicable</th><th>Total</th></tr></thead>';
        const rows = displayLabels.map((disp, idx) => {
            const raw = rawLabels[idx];
            const dist = envCat[raw]?.rating_distribution || {};
            const { exc, good, avg, poor, na } = parseBuckets(dist);
            const total = exc + good + avg + poor + na;
            const pct = (v) => total ? ` (${(v*100/total).toFixed(1)}%)` : '';
            return `<tr><td>${disp}</td><td>${exc.toLocaleString()}${pct(exc)}</td><td>${good.toLocaleString()}${pct(good)}</td><td>${avg.toLocaleString()}${pct(avg)}</td><td>${poor.toLocaleString()}${pct(poor)}</td><td>${na.toLocaleString()}${pct(na)}</td><td>${total.toLocaleString()}</td></tr>`;
        }).join('');
        table.innerHTML = header + `<tbody>${rows}</tbody>`;
    }
}

function renderCommunicationSection(data) {
    console.log('💬 renderCommunicationSection called, CURRENT_BRANCH:', CURRENT_BRANCH);
    const cmDetail = data.communication_metrics_detail || {};
    const keys = Object.keys(cmDetail);
    console.log('💬 Communication metrics:', keys);
    const el = document.getElementById('communicationChart');
    if (el && el.parentElement) {
        const h = Math.max(240, keys.length * 52);
        el.parentElement.style.height = h + 'px';
        try { el.height = h; } catch(_) {}
    }
    const countsByLabel = Object.fromEntries(keys.map(k => [k, cmDetail[k]?.rating_distribution || {}]));
    if (keys.length) renderBucketStackedChart('communicationChart', keys, countsByLabel, { indexAxis: 'y', showAvgLabel: true });

    try {
        renderAvgBucketsTable('communicationTable', keys.map(k => ({
            label: k,
            avg: cmDetail?.[k]?.average ?? null,
            counts: cmDetail?.[k]?.rating_distribution || {}
        })));
    } catch (_) {}
    try { renderAdminChart(data); } catch(e) { }

    const roles = data.concern_roles || {};
    const rc = (typeof resetCanvas === 'function' ? resetCanvas('concernRoleChart') : null) || document.getElementById('concernRoleChart')?.getContext('2d');
    if (rc) {
        const raw = Object.keys(roles);
        const labels = raw.map(l => toEnglishLabel(l));
        const values = raw.map(l => roles[l] || 0);
        new Chart(rc, { type: 'bar', data: { labels, datasets: [{ label: 'Avg', data: values, backgroundColor: '#ab47bc' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 5 } }, plugins: { tooltip: { callbacks: { label: (ctx) => { const lab = ctx.label; const val = ctx.parsed.y ?? ctx.parsed.x; const n = findItemCountInCategories(data, lab); const pct = `${((Number(val)||0)/5*100).toFixed(0)}%`; return `${lab}: ${Number(val).toFixed(2)}/5${n? ` (n=${n.toLocaleString()})`:''} • ${pct}`; } } } } } });
    }

    const cr = data.concern_resolution || {};
    const crc = (typeof resetCanvas === 'function' ? resetCanvas('concernResolutionChart') : null) || document.getElementById('concernResolutionChart')?.getContext('2d');
    if (crc) {
        const labels = ['Yes','No','Not Applicable'];
        const values = labels.map(l => cr[l] || 0);
        new Chart(crc, { type: 'pie', data: { labels, datasets: [{ data: values, backgroundColor: ['#43a047','#e53935','#90a4ae'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, pieValueLabel: { fontSize: 11 } } }, plugins: [PieValueLabelPlugin] });
    }
    // Populate concern resolution counts KPIs
    try {
        const cr = data.concern_resolution || {};
        const yes = cr['Yes'] || 0, no = cr['No'] || 0, na = cr['Not Applicable'] || 0;
        const tot = yes + no + na;
        const fmt = (n) => tot ? `${(n||0).toLocaleString()} (${((n/tot)*100).toFixed(1)}%)` : (n||0).toLocaleString();
        const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = fmt(val); };
        setTxt('concernYesCount', yes);
        setTxt('concernNoCount', no);
        setTxt('concernNaCount', na);
    } catch (e) { }
}

function renderInfrastructureSection(data) {
    console.log('🏗️ renderInfrastructureSection called, CURRENT_BRANCH:', CURRENT_BRANCH);
    // Use Infrastructure detailed metrics - use the viewData directly (already filtered by deriveViewData)
    let infra = (data.category_performance && data.category_performance['Infrastructure']) || {};
    console.log('🏗️ Infrastructure categories:', Object.keys(infra));
    const raw = Object.keys(infra);
    const ic = (typeof resetCanvas === 'function' ? resetCanvas('infraCategoryChart') : null) || document.getElementById('infraCategoryChart')?.getContext('2d');
    if (ic) {
        const el = document.getElementById('infraCategoryChart');
        if (el && el.parentElement) {
            const h = Math.max(260, raw.length * 44);
            el.parentElement.style.height = h + 'px';
            try { el.height = h; } catch(_) {}
        }
        const labels = raw.map(toEnglishLabel);
        const countsByLabel = Object.fromEntries(raw.map(l => {
            const dist = infra[l]?.rating_distribution || {};
            const b = parseRatingBuckets(dist);
            return [l, { Excellent: b.exc, Good: b.good, Average: b.avg, Poor: b.poor, 'Not Applicable': b.na, Unanswered: b.un }];
        }));
        const datasets = RATING_BUCKETS.map(bucket => ({
            label: bucket,
            backgroundColor: RATING_BUCKET_COLORS[bucket],
            barPercentage: 0.9,
            categoryPercentage: 0.9,
            data: raw.map(l => bucketCountGet(countsByLabel?.[l], bucket))
        }));
        new Chart(ic, {
            type: 'bar',
            data: { labels, datasets },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    avgValueLabel: { countsByLabel, labelsFull: raw, fontSize: 11 },
                    stackedValueLabel: { showSegments: true, showTotal: false, fontSize: 10, minPx: 20 },
                    tooltip: {
                        callbacks: {
                            title: (tt) => toEnglishLabel(raw[tt[0].dataIndex]),
                            label: (ctx) => {
                                const lab = raw[ctx.dataIndex];
                                const counts = countsByLabel?.[lab] || {};
                                const total = RATING_BUCKETS.reduce((a,b)=> a + bucketCountGet(counts, b), 0);
                                const val = ctx.parsed.x || 0;
                                const pct = total ? `${(val*100/total).toFixed(1)}%` : '';
                                return `${ctx.dataset.label}: ${Number(val).toLocaleString()}${pct ? ` (${pct})` : ''}`;
                            }
                        }
                    }
                },
                scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true, ticks: { autoSkip: false, font: { size: 10 } } } }
            },
            plugins: [AvgValueLabelPlugin, StackedValueLabelPlugin]
        });

        try {
            renderAvgBucketsTable('infraCategoryTable', raw.map(l => ({
                label: l,
                avg: infra?.[l]?.average ?? null,
                counts: countsByLabel?.[l] || {}
            })));
        } catch (_) {}
    }

    // Simple heatmap: Branch x {Academics, Infrastructure, Environment, Administration}
    const container = document.getElementById('infraHeatmap');
    if (container) {
        console.log('🏗️ Rendering heatmap, branch_performance:', Object.keys(data.branch_performance || {}));
        const branchesAll = RAW_DATA?.branch_performance || {};
        const branchesForRanks = (branchesAll && Object.keys(branchesAll).length) ? branchesAll : (data.branch_performance || {});
        const brRatingCounts = (data.branch_rating_counts || RAW_DATA?.branch_rating_counts || {});
        const cols = ['Academics','Infrastructure','Environment','Administration'];
        const groupKey = {
            Academics: 'Subjects',
            Infrastructure: 'Infrastructure',
            Environment: 'Environment',
            Administration: 'Administrative Support'
        };
        const paletteHue = {
            Academics: 145,
            Infrastructure: 35,
            Environment: 200,
            Administration: 285
        };
        const clamp01 = (x) => Math.max(0, Math.min(1, x));
        const bgForScore = (col, v) => {
            const h = paletteHue[col] ?? 210;
            const t = clamp01((Number(v) || 0) / 5);
            const sat = 70;
            const light = 22 + t * 34;
            return `hsl(${h}, ${sat}%, ${light}%)`;
        };
        const bgForNeeds = (pct) => {
            if (pct == null || isNaN(pct)) return '#90a4ae';
            const t = clamp01(Number(pct) / 35);
            const hue = 120 - 120 * t;
            return `hsl(${hue}, 78%, 38%)`;
        };
        const getDist = (branch, col) => {
            const groups = brRatingCounts?.[branch] || null;
            const gk = groupKey[col];
            return (groups && gk) ? (groups[gk] || null) : null;
        };
        const answeredNFromDist = (dist) => {
            if (!dist) return null;
            const exc = Number(dist.Excellent) || 0;
            const good = Number(dist.Good) || 0;
            const avg = Number(dist.Average) || 0;
            const poor = Number(dist.Poor) || 0;
            const n = exc + good + avg + poor;
            return n > 0 ? n : null;
        };
        const needsCountFromDist = (dist) => {
            if (!dist) return null;
            const avg = Number(dist.Average) || 0;
            const poor = Number(dist.Poor) || 0;
            const n = avg + poor;
            return n > 0 ? n : 0;
        };
        const needsPctFromDist = (dist) => {
            if (!dist) return null;
            const exc = Number(dist.Excellent) || 0;
            const good = Number(dist.Good) || 0;
            const avg = Number(dist.Average) || 0;
            const poor = Number(dist.Poor) || 0;
            const n = exc + good + avg + poor;
            if (!n) return null;
            return (avg + poor) * 100 / n;
        };
        const overallNeedsForBranch = (branch) => {
            let exc = 0, good = 0, avg = 0, poor = 0;
            const perCol = {};
            for (const c of cols) {
                const dist = getDist(branch, c);
                const e = Number(dist?.Excellent) || 0;
                const g = Number(dist?.Good) || 0;
                const a = Number(dist?.Average) || 0;
                const p = Number(dist?.Poor) || 0;
                exc += e; good += g; avg += a; poor += p;
                perCol[c] = {
                    pct: (e + g + a + p) ? ((a + p) * 100 / (e + g + a + p)) : null,
                    needCount: (a + p),
                    answered: (e + g + a + p)
                };
            }
            const n = exc + good + avg + poor;
            const overall = n ? ((avg + poor) * 100 / n) : null;
            const overallNeedCount = (avg + poor);
            const overallAnswered = n;
            let focus = null;
            let focusPct = null;
            let focusNeedCount = null;
            for (const c of cols) {
                const p = perCol[c]?.pct;
                if (p == null || isNaN(p)) continue;
                if (focusPct == null || p > focusPct) {
                    focusPct = p;
                    focus = c;
                    focusNeedCount = perCol[c]?.needCount ?? null;
                }
            }
            return { overall, overallNeedCount, overallAnswered, focus, focusPct, focusNeedCount };
        };
        const makeRankMap = (arr, key) => {
            const sorted = arr
                .map(r => ({ b: r.Branch, v: r[key] }))
                .filter(x => x.v != null && !isNaN(x.v))
                .sort((a,b)=> (b.v - a.v));
            const out = {};
            for (let i=0; i<sorted.length; i++) out[sorted[i].b] = i + 1;
            return out;
        };
        const rowsAll = Object.entries(branchesForRanks).map(([b, v]) => {
            const needs = overallNeedsForBranch(b);
            return {
                Branch: b,
                Overall: v.overall_avg,
                Count: v.count,
                Academics: v.subject_avg,
                Infrastructure: v.infrastructure_avg,
                Environment: v.environment_avg,
                Administration: v.admin_avg,
                Needs: needs
            };
        });
        const rowByBranch = Object.fromEntries(rowsAll.map(r => [r.Branch, r]));
        const overallRank = makeRankMap(rowsAll, 'Overall');
        const rankByCol = {
            Academics: makeRankMap(rowsAll, 'Academics'),
            Infrastructure: makeRankMap(rowsAll, 'Infrastructure'),
            Environment: makeRankMap(rowsAll, 'Environment'),
            Administration: makeRankMap(rowsAll, 'Administration')
        };
        // Get selected category filter
        const filterSelect = document.getElementById('heatmapCategoryFilter');
        const selectedCategory = filterSelect?.value || 'Overall';
        
        // Sort by selected category
        if (!CURRENT_BRANCH) {
            if (selectedCategory === 'Overall') {
                rowsAll.sort((a,b)=> (overallRank[a.Branch] || 999999) - (overallRank[b.Branch] || 999999));
            } else {
                const catRank = rankByCol[selectedCategory] || {};
                rowsAll.sort((a,b)=> (catRank[a.Branch] || 999999) - (catRank[b.Branch] || 999999));
            }
        }

        const rows = CURRENT_BRANCH ? rowsAll.filter(r => r.Branch === CURRENT_BRANCH) : rowsAll;

        // Update rank display based on selected category
        const getRankForDisplay = (branch) => {
            if (selectedCategory === 'Overall') {
                return overallRank[branch] || null;
            } else {
                return rankByCol[selectedCategory]?.[branch] || null;
            }
        };

        const makeMetricCell = (branch, col, val) => {
            const vOk = !(val == null || isNaN(val));
            const v = vOk ? Number(val) : 0;
            const dist = getDist(branch, col);
            const n = answeredNFromDist(dist);
            const needsPct = needsPctFromDist(dist);
            const needsCount = needsCountFromDist(dist);
            const rank = rankByCol[col]?.[branch] || null;
            const pctScore = vOk ? Math.round((v / 5) * 100) : null;
            const subBits = [];
            if (rank != null) subBits.push(`#${rank}`);
            if (n != null) subBits.push(`n=${Number(n).toLocaleString()}`);
            if (pctScore != null) subBits.push(`${pctScore}%`);
            const sub = subBits.length ? `<div style="font-size:0.85em; font-weight:800; opacity:0.95; margin-top:2px;">${subBits.join(' • ')}</div>` : '';
            const sub2 = (needsPct != null && !isNaN(needsPct)) ? `<div style="font-size:0.82em; font-weight:800; opacity:0.95; margin-top:2px;">Needs: ${needsPct.toFixed(1)}% (${Number(needsCount||0).toLocaleString()})</div>` : '';
            const bg = vOk ? bgForScore(col, v) : '#90a4ae';
            return `<td style="background:${bg}; color:#fff; text-align:center; padding:8px;">`+
                `<div style="font-weight:900; font-size:1.05em; line-height:1.1;">${vOk ? v.toFixed(2) : '-'}</div>${sub}${sub2}</td>`;
        };
        const makeNeedsCell = (branch) => {
            const n = rowByBranch?.[branch]?.Needs || { overall: null, overallNeedCount: null, overallAnswered: null, focus: null, focusPct: null, focusNeedCount: null };
            const vOk = n.overall != null && !isNaN(n.overall);
            const bg = bgForNeeds(n.overall);
            const overallCnt = (n.overallNeedCount != null && !isNaN(n.overallNeedCount)) ? ` (${Number(n.overallNeedCount).toLocaleString()})` : '';
            const focus = (n.focus && n.focusPct != null && !isNaN(n.focusPct))
                ? `${toEnglishLabel(n.focus)} ${n.focusPct.toFixed(1)}%${(n.focusNeedCount != null && !isNaN(n.focusNeedCount)) ? ` (${Number(n.focusNeedCount).toLocaleString()})` : ''}`
                : '-';
            return `<td style="background:${bg}; color:#fff; text-align:center; padding:8px;">`+
                `<div style="font-weight:900; font-size:1.05em; line-height:1.1;">${vOk ? `${n.overall.toFixed(1)}%${overallCnt}` : '-'}</div>`+
                `<div style="font-size:0.82em; font-weight:800; opacity:0.95; margin-top:2px;">Focus: ${focus}</div></td>`;
        };

        const thStyle = (col) => {
            const h = paletteHue[col] ?? 210;
            return `background: hsl(${h}, 70%, 26%); color:#fff;`;
        };
        
        // Build table headers and rows based on selected category
        let headerHtml = `<th style="background:#001f3f;color:#fff;">Rank</th>`+
            `<th style="background:#001f3f;color:#fff;">Branch</th>`;
        
        if (selectedCategory === 'Overall') {
            // Show all columns for Overall
            headerHtml += `<th style="${thStyle('Academics')}">Academics</th>`+
                `<th style="${thStyle('Infrastructure')}">Infrastructure</th>`+
                `<th style="${thStyle('Environment')}">Environment</th>`+
                `<th style="${thStyle('Administration')}">Administration</th>`;
        } else {
            // Show only selected category column
            headerHtml += `<th style="${thStyle(selectedCategory)}">${selectedCategory}</th>`;
        }
        
        const rowsHtml = rows.map(r => {
            const rk = getRankForDisplay(r.Branch);
            let cellsHtml = `<td style="background:#001f3f;color:#fff;padding:8px;text-align:center;font-weight:900;">${rk!=null? `#${rk}`:'-'}</td>`+
                `<td style="background:#001f3f;color:#fff;padding:8px;">${toEnglishLabel(r.Branch)}</td>`;
            
            if (selectedCategory === 'Overall') {
                // Show all columns
                cellsHtml += `${makeMetricCell(r.Branch, 'Academics', r.Academics)}`+
                    `${makeMetricCell(r.Branch, 'Infrastructure', r.Infrastructure)}`+
                    `${makeMetricCell(r.Branch, 'Environment', r.Environment)}`+
                    `${makeMetricCell(r.Branch, 'Administration', r.Administration)}`;
            } else {
                // Show only selected category
                cellsHtml += makeMetricCell(r.Branch, selectedCategory, r[selectedCategory]);
            }
            
            return `<tr>${cellsHtml}</tr>`;
        }).join('');
        
        container.innerHTML = `<div style="overflow:auto"><table class="ranking-table"><thead><tr>`+
            headerHtml+
            `</tr></thead><tbody>`+
            rowsHtml+
            `</tbody></table></div>`;
        
        // Add event listener to filter dropdown
        if (filterSelect && !filterSelect.dataset.listenerAttached) {
            filterSelect.dataset.listenerAttached = 'true';
            filterSelect.addEventListener('change', () => {
                renderInfrastructureSection(RAW_DATA || {});
            });
        }
    }
}

function renderStrengthsSection(data) {
    console.log('⭐ renderStrengthsSection called, CURRENT_BRANCH:', CURRENT_BRANCH);
    const cat = Object.assign({}, data.summary.category_scores || {});
    console.log('⭐ Category scores:', cat);
    // Derive Communication aggregate
    const cm = data.communication_metrics || {};
    const commVals = Object.values(cm);
    if (commVals.length) cat['Communication'] = commVals.reduce((a,b)=>a+(b||0),0)/commVals.length;
    // Add Safety/Hygiene/PTM if present
    const safety = data.environment_focus?.['Campus safety'];
    if (safety!=null) cat['Safety'] = safety;
    let hygiene = null; const infra = data.category_performance?.['Infrastructure'] || {};
    for (const [k,v] of Object.entries(infra)) { const low = k.toLowerCase(); if (low.includes('hygiene')||low.includes('clean')) { hygiene = v?.average ?? hygiene; } }
    if (hygiene!=null) cat['Hygiene'] = hygiene;
    if (data.ptm_effectiveness!=null) cat['PTM'] = data.ptm_effectiveness;

    const pairs = Object.entries(cat).filter(([,v])=> v!=null && !isNaN(v));
    const top = pairs.slice().sort((a,b)=>b[1]-a[1]).slice(0,5);
    const low = pairs.slice().sort((a,b)=>a[1]-b[1]).slice(0,5);

    const sumCounts = (arr) => {
        const out = { Excellent: 0, Good: 0, Average: 0, Poor: 0, 'Not Applicable': 0, Unanswered: 0 };
        for (const c of (arr || [])) {
            if (!c) continue;
            out.Excellent += Number(c.Excellent) || 0;
            out.Good += Number(c.Good) || 0;
            out.Average += Number(c.Average) || 0;
            out.Poor += Number(c.Poor) || 0;
            out['Not Applicable'] += Number(c['Not Applicable']) || 0;
            out.Unanswered += Number(c.Unanswered) || 0;
        }
        return out;
    };

    const countsForKey = (key) => {
        const k = String(key || '').trim();
        const overall = data.overall_rating_counts || {};
        if (overall[k]) return overall[k];
        return null;
    };

    const hasAny = (counts) => {
        if (!counts) return false;
        const total = RATING_BUCKETS.reduce((a,b)=> a + bucketCountGet(counts, b), 0);
        return total > 0;
    };

    const buildCountsMap = (items) => {
        const labels = items.map(([k]) => k);
        const map = {};
        for (const l of labels) {
            const c = countsForKey(l);
            if (hasAny(c)) map[l] = c;
        }
        const filtered = labels.filter(l => map[l]);
        return { labels: filtered, countsByLabel: map };
    };

    const strengthCtx = (typeof resetCanvas === 'function' ? resetCanvas('topStrengthsChart') : null) || document.getElementById('topStrengthsChart')?.getContext('2d');
    if (strengthCtx) {
        const el = document.getElementById('topStrengthsChart');
        const { labels, countsByLabel } = buildCountsMap(top);
        if (el && el.parentElement) {
            const h = Math.max(240, labels.length * 56);
            el.parentElement.style.height = h + 'px';
            try { el.height = h; } catch(_) {}
        }
        if (labels.length) renderBucketStackedChart('topStrengthsChart', labels, countsByLabel, { indexAxis: 'y', showAvgLabel: true });
    }

    const impCtx = (typeof resetCanvas === 'function' ? resetCanvas('topImprovementsChart') : null) || document.getElementById('topImprovementsChart')?.getContext('2d');
    if (impCtx) {
        const el = document.getElementById('topImprovementsChart');
        const { labels, countsByLabel } = buildCountsMap(low);
        if (el && el.parentElement) {
            const h = Math.max(240, labels.length * 56);
            el.parentElement.style.height = h + 'px';
            try { el.height = h; } catch(_) {}
        }
        if (labels.length) renderBucketStackedChart('topImprovementsChart', labels, countsByLabel, { indexAxis: 'y', showAvgLabel: true });
    }
}

function renderBranchComparisonSection(data) {
    const branchSection = document.getElementById('section-branch');
    if (branchSection) branchSection.style.display = CURRENT_BRANCH ? 'none' : '';
    if (CURRENT_BRANCH) return; // no-op when a specific branch is selected
    // Hide 'Top 5 Branches by Reviews (All)' when a branch is selected
    try {
        const topTbl = document.getElementById('branchTopReviewsTable');
        const wrap = topTbl ? topTbl.closest('.chart-container') : null;
        if (wrap) wrap.style.display = CURRENT_BRANCH ? 'none' : '';
    } catch(_) {}
    const ranked = (data.rankings?.branches || []);
    const rankCtx = (typeof resetCanvas === 'function' ? resetCanvas('branchRankedChart') : null) || document.getElementById('branchRankedChart')?.getContext('2d');
    if (rankCtx) {
        const arr = ranked.slice();
        const parent = document.getElementById('branchRankedChart')?.parentElement;
        if (parent) parent.style.height = Math.max(400, arr.length * 24) + 'px';
        const colorFor = (v) => {
            const x = Math.max(0, Math.min(1, (v || 0) / 5));
            if (x < 0.5) {
                const t = x / 0.5;
                const r = Math.round(229 + (251-229)*t);
                const g = Math.round(57 + (140-57)*t);
                const b = Math.round(53 + (0-53)*t);
                return `rgb(${r},${g},${b})`;
            } else {
                const t = (x-0.5)/0.5;
                const r = Math.round(251 + (67-251)*t);
                const g = Math.round(140 + (160-140)*t);
                const b = Math.round(0 + (71-0)*t);
                return `rgb(${r},${g},${b})`;
            }
        };
        new Chart(rankCtx, {
            type: 'bar',
            data: { labels: arr.map(x=>toEnglishLabel(x[0])), datasets: [{ label: 'Overall', data: arr.map(x=>x[1]), backgroundColor: arr.map(x=>colorFor(x[1])) }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                layout: { padding: { right: 40 } },
                scales: { x: { beginAtZero: true, max: 5 } },
                plugins: {
                    barValueLabel: { decimals: 2, fontSize: 11 },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const lab = ctx.label;
                                const val = ctx.parsed.x ?? ctx.parsed.y;
                                const pct = `${((Number(val)||0)/5*100).toFixed(0)}%`;
                                let n = null;
                                try {
                                    const bp = data.branch_performance || {};
                                    for (const [b,v] of Object.entries(bp)) {
                                        if (toEnglishLabel(b) === lab) {
                                            n = v?.count || null;
                                            break;
                                        }
                                    }
                                } catch(_) {}
                                return `${lab}: ${Number(val).toFixed(2)}/5${n? ` (n=${n.toLocaleString()})`:''} • ${pct}`;
                            }
                        }
                    }
                }
            },
            plugins: [BarValueLabelPlugin]
        });
    }

    let brPct = (data.branch_recommendation_pct || {});
    // Fallback: if no pct available, derive from counts when possible
    try {
        const hasAny = Object.values(brPct || {}).some(v => v != null && !isNaN(v));
        if (!hasAny && data.branch_recommendation_counts) {
            const tmp = {};
            for (const [b, c] of Object.entries(data.branch_recommendation_counts)) {
                const yes = c?.Yes || 0, no = c?.No || 0, maybe = c?.Maybe || 0;
                const tot = yes + no + maybe;
                tmp[b] = tot > 0 ? (yes / tot * 100.0) : null;
            }
            brPct = tmp;
        }
    } catch (_e) {}
    const recCtx = (typeof resetCanvas === 'function' ? resetCanvas('branchRecommendChart') : null) || document.getElementById('branchRecommendChart')?.getContext('2d');
    if (recCtx) {
        const entries = Object.entries(brPct).filter(([,v])=> v!=null);
        entries.sort((a,b)=>b[1]-a[1]);
        const labels = entries.slice(0,20).map(x=>toEnglishLabel(x[0]).slice(0,18));
        const values = entries.slice(0,20).map(x=>x[1]);
        new Chart(recCtx, { type: 'bar', data: { labels, datasets: [{ label: '% Recommend', data: values, backgroundColor: '#8d6e63' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } }, plugins: { barValueLabel: { decimals: 1, suffix: '%' } } }, plugins: [BarValueLabelPlugin] });
    }

    const scatterCtx = (typeof resetCanvas === 'function' ? resetCanvas('branchScatterChart') : null) || document.getElementById('branchScatterChart')?.getContext('2d');
    if (scatterCtx) {
        const branches = data.branch_performance || {};
        const points = Object.entries(branches).map(([name,val])=> ({ x: val.subject_avg || 0, y: val.infrastructure_avg || 0, r: Math.max(4, Math.min(10, (val.count||10)/50)), label: toEnglishLabel(name) }));
        new Chart(scatterCtx, { type: 'scatter', data: { datasets: [{ label: 'Branches', data: points, parsing: false, pointBackgroundColor: '#42a5f5' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Academics' }, min: 0, max: 5 }, y: { title: { display: true, text: 'Infrastructure' }, min: 0, max: 5 } }, plugins: { tooltip: { callbacks: { label: (ctx)=> `${ctx.raw.label}: (${ctx.raw.x.toFixed(2)}, ${ctx.raw.y.toFixed(2)})` } } } } });
    }

    // Helpers for filters and percentages
    const classSel = document.getElementById('branchClassFilter');
    const orientSel = document.getElementById('branchOrientationFilter');
    const pctStr = (num, den) => {
        if (!den) return '-';
        return `${((num/den)*100).toFixed(1)}%`;
    };
    const fillSelect = (sel, keys) => {
        if (!sel) return;
        if (sel.options.length <= 1) {
            keys.forEach(k => {
                const opt = document.createElement('option');
                opt.value = k; opt.textContent = toEnglishLabel(k); sel.appendChild(opt);
            });
        }
    };
    // Populate filter options from summary
    fillSelect(classSel, Object.keys(data.summary?.classes || {}));
    fillSelect(orientSel, Object.keys(data.summary?.orientations || {}));

    // Resolve current recommendation counts source based on filters
    const currentRecCounts = () => {
        const cls = classSel?.value || '';
        const ori = orientSel?.value || '';
        const by = data.branch_recommendation_counts_by || {};
        if (cls && ori) return (by.pair?.[cls]?.[ori]) || {};
        if (cls) return (by.class?.[cls]) || {};
        if (ori) return (by.orientation?.[ori]) || {};
        return data.branch_recommendation_counts || {};
    };
    // Resolve current rating counts source based on filters
    const currentRatingCounts = () => {
        const cls = classSel?.value || '';
        const ori = orientSel?.value || '';
        const by = data.branch_rating_counts_by || {};
        if (cls && ori) return (by.pair?.[cls]?.[ori]) || {};
        if (cls) return (by.class?.[cls]) || {};
        if (ori) return (by.orientation?.[ori]) || {};
        return data.branch_rating_counts || {};
    };

    // Update recommendation tables (counts + %)
    const updateRecTables = () => {
        const counts = currentRecCounts();
        const rows = Object.entries(counts).map(([b, c])=> {
            const yes = c?.Yes || 0, no = c?.No || 0, maybe = c?.Maybe || 0, na = c?.['Not Applicable'] || 0;
            const totalRec = yes + no + maybe; // denominator for %
            const totalAll = totalRec + na;
            return { branch: b, yes, no, maybe, na, totalRec, totalAll };
        });
        const topYes = rows.slice().sort((a,b)=> b.yes - a.yes).slice(0, 15);
        const topNo = rows.slice().sort((a,b)=> b.no - a.no).slice(0, 15);
        const render = (id, rws) => {
            const el = document.getElementById(id); if (!el) return;
            el.innerHTML = '<thead><tr><th>Branch</th><th>Yes</th><th>No</th><th>Maybe</th><th>NA</th><th>Total</th></tr></thead>' +
                '<tbody>' + rws.map(r=> `<tr><td>${toEnglishLabel(r.branch)}</td>`+
                `<td>${r.yes.toLocaleString()} (${pctStr(r.yes, r.totalRec)})</td>`+
                `<td>${r.no.toLocaleString()} (${pctStr(r.no, r.totalRec)})</td>`+
                `<td>${r.maybe.toLocaleString()} (${pctStr(r.maybe, r.totalRec)})</td>`+
                `<td>${r.na.toLocaleString()}</td>`+
                `<td>${r.totalAll.toLocaleString()}</td>`+
                `</tr>`).join('') + '</tbody>';
        };
        render('branchYesRecsTable', topYes);
        render('branchNoRecsTable', topNo);
    };

    // Update rating tables (Poor/Excellent: counts + %)
    const updateRatingTables = () => {
        const ratingCounts = currentRatingCounts();
        const select = document.getElementById('ratingGroupSelect');
        const group = select?.value || 'Subjects';
        const rows = Object.entries(ratingCounts).map(([b, groups]) => {
            const g = groups?.[group] || {};
            const ex = g.Excellent || 0, gd = g.Good || 0, av = g.Average || 0, pr = g.Poor || 0;
            const tot = ex + gd + av + pr;
            return { branch: b, Excellent: ex, Poor: pr, Total: tot };
        });
        const topPoor = rows.slice().sort((a,b)=> b.Poor - a.Poor).slice(0, 5);
        const topExcellent = rows.slice().sort((a,b)=> b.Excellent - a.Excellent).slice(0, 15);
        const render = (id, rws, key, label) => {
            const el = document.getElementById(id); if (!el) return;
            el.innerHTML = `<thead><tr><th>Branch</th><th>${label} Count</th><th>${label} %</th><th>Total Rated</th></tr></thead>` +
                '<tbody>' + rws.map(r=> `<tr><td>${toEnglishLabel(r.branch)}</td><td>${r[key].toLocaleString()}</td><td>${pctStr(r[key], r.Total)}</td><td>${r.Total.toLocaleString()}</td></tr>`).join('') + '</tbody>';
        };
        render('branchPoorTable', topPoor, 'Poor', 'Poor');
        render('branchExcellentTable', topExcellent, 'Excellent', 'Excellent');
    };

    // Wire up listeners
    const ratingGroupSel = document.getElementById('ratingGroupSelect');
    if (ratingGroupSel) ratingGroupSel.addEventListener('change', updateRatingTables);
    if (classSel) classSel.addEventListener('change', () => { updateRecTables(); updateRatingTables(); });
    if (orientSel) orientSel.addEventListener('change', () => { updateRecTables(); updateRatingTables(); });
    // no branchCompareScope control; section visibility auto-handled by CURRENT_BRANCH

    // Top 5 branches by total reviews (all)
    const updateTopReviewsTable = () => {
        const el = document.getElementById('branchTopReviewsTable');
        if (!el) return;
        const bp = data.branch_performance || {};
        const rows = Object.entries(bp).map(([b, v]) => ({ branch: b, count: v?.count || 0 }));
        rows.sort((a,b)=> b.count - a.count);
        const top = rows.slice(0,5);
        el.innerHTML = '<thead><tr><th>Branch</th><th>Total Reviews</th></tr></thead>' +
            '<tbody>' + top.map(r => `<tr><td>${toEnglishLabel(r.branch)}</td><td>${r.count.toLocaleString()}</td></tr>`).join('') + '</tbody>';
    };

    // Initial render
    updateRecTables();
    updateRatingTables();
    updateTopReviewsTable();
}
