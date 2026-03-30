// GLOBAL VARIABLES
let originalDataset = [];
let dataset = [];
let globalAverages = {};
let selectedTrack = null;
let globalAnimationDuration = 0;
let minYear;
let maxYear;
let selectedYear;
let mixerFilters = { valence: null, danceability: null, acousticness: null, energy: null };
let isDraggingThumb = { valence: false, danceability: false, acousticness: false, energy: false };
let yearlyAverages = [];
let showIndustryEvents = true;

const industryEvents = [
    { year: 2013, label: "Vine Launches", description: "Birth of the 6-second loop. Forced music to rely on punchy, repetitive ad-libs for comedy sketches." },
    { year: 2014, label: "Musical.ly Launches", description: "The Lip-Sync Era. 15-second audio snippets become more important than full tracks." },
    { year: 2018, label: "TikTok Global Merger", description: "The Algorithm Takeover. Record labels begin forcing 'TikTok-friendly' hooks in the first 15 seconds." },
    { year: 2020, label: "Pandemic Lockdowns", description: "Screen time peaks. Massive rise in user-generated dance trends and 'Sped-Up' remixes." },
    { year: 2023, label: "Peak 'Brainrot'", description: "Hyper-fragmented, high-stimulation content dominates. Songs become significantly shorter with meme-focused lyrics." }
];

const audioMetrics = [
    'acousticness', 'danceability', 'energy', 'instrumentalness',
    'liveness', 'loudness', 'speechiness', 'tempo', 'valence', 'duration_min'
];

const textMetrics = [
    'Flesch_Kincaid_Grade', 'Lexical_Diversity', 'Avg_Word_Length', 'Sentiment_Score'
];

const allFeatures = [...audioMetrics, ...textMetrics];

let activeFeatures = ['acousticness', 'danceability', 'energy', 'valence'];

function normalize(value, min, max) {
    if (max === min) return 0;
    return (value - min) / (max - min);
}

function safeId(str) {
    if (!str) return "unknown";
    return str.toString().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}

// Store duration as true fractional minutes (e.g. 225sec = 3.75 min) so averaging works.
// Display uses formatDuration() which renders it as M.SS (e.g. 3.75 → "3:45").
function msToMinSec(ms) {
    return ms / 60000; // true decimal minutes
}

// Format fractional minutes as M.SS display string (3.75 → "3.45", 4.0 → "4.00")
function formatDuration(fracMin) {
    const mins = Math.floor(fracMin);
    const secs = Math.round((fracMin - mins) * 60);
    return mins + '.' + String(secs).padStart(2, '0');
}

let featureStats = {};
const colorScale = d3.scaleOrdinal(d3.schemePaired); // Different colors for artists

// Human-readable display name for any feature key
const featureLabelMap = {
    duration_min: 'Duration (min)',
    Sentiment_Score: 'Sentiment Score'
};
function featureLabel(f) {
    if (featureLabelMap[f]) return featureLabelMap[f];
    return f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' ');
}

// Format a feature value for display — duration_min uses M.SS, tempo uses integer, others 2dp
function formatFeatureVal(f, val) {
    if (f === 'duration_min') return formatDuration(val);
    if (f === 'tempo') return d3.format('.0f')(val);
    return d3.format('.2f')(val);
}


let wordcloudDataset = [];

Promise.all([
    d3.csv("data/masterlist_lyrics_with_features_cleaned_top300_final.csv"),
    d3.csv("data/wordcloud_data_by_year.csv")
]).then(([data, wordData]) => {
    wordData.forEach(d => {
        d.Year = parseInt(d.Year) || 0;
        d.Frequency = parseInt(d.Frequency) || 0;
    });
    wordcloudDataset = wordData;

    // Pre-index wordcloud data for O(1) tooltip lookup: [Year][Category] -> Sorted Words
    window.lyricLookupIndex = d3.group(wordcloudDataset, d => d.Year, d => d.Category);

    // Sort words in index by frequency once at start to save compute during hover
    window.lyricLookupIndex.forEach(yearMap => {
        yearMap.forEach((words, cat) => {
            const top7 = words.sort((a, b) => b.Frequency - a.Frequency).slice(0, 7);
            yearMap.set(cat, top7);
        });
    });

    data.forEach(d => {
        d.Streams = parseFloat(d.Streams) || 0;
        d.Year = parseInt(d.Year) || 2024;
        d.key = parseInt(d.key);
        d.mode = parseInt(d.mode);
        // Parse all numeric features (duration_min not in CSV, handled below)
        allFeatures.forEach(f => {
            if (f === 'duration_min') return; // handled separately
            d[f] = isNaN(parseFloat(d[f])) ? 0 : +d[f];
        });
        // Convert CSV's duration_ms column → duration_min (M.SS decimal)
        const rawMs = parseFloat(d.duration_ms);
        d.duration_min = (!isNaN(rawMs) && rawMs > 0) ? msToMinSec(rawMs) : 0;
    });

    originalDataset = data;
    dataset = [...originalDataset];

    // Set up Year Slider
    const years = originalDataset.map(d => d.Year).filter(y => !isNaN(y));
    minYear = d3.min(years);
    maxYear = d3.max(years);
    selectedYear = minYear;
    computeYearlyTrends();

    // Update Dynamic Title
    d3.select("#trendHeader").text(`Feature Averages vs Time (${minYear} - ${maxYear})`);

    const yearSlider = d3.select("#yearSlider");
    yearSlider.attr("min", minYear).attr("max", maxYear).attr("value", minYear);

    d3.select("#yearLabel").text(minYear);
    dataset = originalDataset.filter(d => d.Year === minYear);

    yearSlider.on("input", function () {
        const val = +this.value;
        d3.select("#yearLabel").text(val);
        filterByYear(val, false);
    });

    d3.select("#yearPrevBtn").on("click", function () {
        let val = parseInt(yearSlider.property("value"));
        if (val > minYear) {
            val--;
            yearSlider.property("value", val);
            d3.select("#yearLabel").text(val);
            filterByYear(val, true);
        }
    });

    d3.select("#yearNextBtn").on("click", function () {
        let val = parseInt(yearSlider.property("value"));
        if (val < maxYear) {
            val++;
            yearSlider.property("value", val);
            d3.select("#yearLabel").text(val);
            filterByYear(val, true);
        }
    });

    d3.select("#resetYearBtn").on("click", function () {
        d3.select("#yearLabel").text("All Time");
        yearSlider.property("value", maxYear);
        filterByYear(null, true);
    });

    let playInterval = null;
    d3.select("#yearPlayBtn").on("click", function () {
        const btn = d3.select(this);
        if (playInterval) {
            clearInterval(playInterval);
            playInterval = null;
            btn.text("▶");
        } else {
            btn.text("⏸");
            playInterval = setInterval(() => {
                let val = parseInt(yearSlider.property("value"));
                if (val >= maxYear) val = minYear - 1;
                val++;
                yearSlider.property("value", val);
                d3.select("#yearLabel").text(val);
                filterByYear(val, true);
            }, 1200);
        }
    });

    computeStats();
    initRadarChart();
    initFeatureToggles();
    initFeatureBubbleChart();
    // initScatterPlots();
    // initHistograms();
    initDistributionCurves();
    initBubbleChart();
    initArtistBarChart();
    initTrendLines();
    initRidgeline();
    initParallelChart();
    // initRadialChart();
    initKeyChart();
    initWordCloud();
    initWordCategoryBarChart();
    initLyricEvolutionChart();
    initMixer();
}).catch(err => {
    console.error("Error loading CSV file:", err);
});

function computeStats() {
    allFeatures.forEach(f => {
        // Find min/max globally to keep the scales 100% stable across time
        const globalArray = originalDataset.map(d => d[f]);
        const currentArray = dataset.map(d => d[f]);

        let min, max;
        // Spotify features represent absolute continuous properties in specific mathematically mapped bounds
        const absoluteBounds01 = ['acousticness', 'danceability', 'energy', 'instrumentalness', 'liveness', 'speechiness', 'valence', 'mode'];

        if (absoluteBounds01.includes(f)) {
            min = 0;
            max = 1;
        } else if (f === 'key') {
            min = 0;
            max = 11;
        } else if (f === 'loudness') {
            min = -60; // Loudness is bounded from theoretically -60dB (silence) to 0dB. 
            max = d3.max(globalArray) || 0;
        } else if (f === 'tempo') {
            min = 0; // True proportional baseline
            max = d3.max(globalArray) || 1;
        } else if (f === 'duration_min') {
            min = 0;
            max = d3.max(globalArray) || 10; // Now in min.sec format, typical songs 2.00–5.00
        } else if (f === 'Sentiment_Score') {
            min = -1; // Sentiment goes from -1 (Negative) to 1 (Positive)
            max = 1;
        } else {
            max = d3.max(globalArray) || 1;
            min = d3.min(globalArray) || 0;
        }

        const mean = currentArray.length > 0 ? (d3.mean(currentArray) || 0) : 0;

        featureStats[f] = { min, max, mean };
        globalAverages[f] = mean;
    });
}

function filterByYear(year, animated = false) {
    globalAnimationDuration = animated ? 800 : 0;
    selectedYear = year;

    selectedTrack = null;
    d3.select("#songDropdown").property("value", "");

    applyFilters();
}

let filterDebounceTimer;
function applyFilters() {
    let baseData = selectedYear === null ? originalDataset : originalDataset.filter(d => d.Year === selectedYear);

    dataset = baseData.filter(d => {
        for (let key in mixerFilters) {
            if (mixerFilters[key] !== null) {
                let normData = normalize(d[key], featureStats[key].min, featureStats[key].max);
                let normFilter = normalize(mixerFilters[key], featureStats[key].min, featureStats[key].max);
                // Filtering strictly to an intuitive 15% range around the fader
                if (Math.abs(normData - normFilter) > 0.15) {
                    return false;
                }
            }
        }
        return true;
    });

    computeStats();

    // Smooth out DOM repaints while aggressively dragging faders
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(() => {
        updateDashboard();
        initBubbleChart();
        updateArtistBarChart();
        updateTrendLines();
        // initRadialChart();
        initKeyChart();
        updateWordCloud();
        updateWordCategoryBarChart();
        updateLyricEvolutionChart();
    }, 10);
}

function updateDashboard() {
    if (selectedTrack) {
        d3.select("#radarSelectedLabel").text(selectedTrack.Title);
        if (selectedTrack.href) {
            const embedUrl = selectedTrack.href.replace("/track/", "/embed/track/");
            d3.select("#spotifyIframe").attr("src", embedUrl);
            d3.select("#spotifyEmbedContainer").style("display", "block");
            d3.select("#spotifyEmbedPlaceholder").style("display", "none");
        }
    } else {
        d3.select("#radarSelectedLabel").text("Selected Track");
        d3.select("#spotifyEmbedContainer").style("display", "none");
        d3.select("#spotifyEmbedPlaceholder").style("display", "flex");
        d3.select("#spotifyIframe").attr("src", "");
    }
    updateRadarChart();
    updateFeatureBubbleChart();
    // updateScatterPlots();
    // updateHistograms();
    updateDistributionCurves();
    updateRidgeline();
    updateParallelChart();
    // updateRadialChart();
    updateKeyChart();
    updateWordCloud();
    updateWordCategoryBarChart();
    updateLyricEvolutionChart();
    updateMixer();
}

function initFeatureToggles() {
    const container = d3.select("#featureToggles");
    container.html("");

    allFeatures.forEach(f => {
        // Regex text replacement parsing bounds for "Flesch_Kincaid_Grade" to "Flesch Kincaid Grade" for polished UI labels
        let displayLabel = f.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        container.append("button")
            .attr("class", "feature-tgl-btn " + (activeFeatures.includes(f) ? "active" : ""))
            .text(displayLabel)
            .on("click", function () {
                if (activeFeatures.includes(f)) {
                    activeFeatures = activeFeatures.filter(x => x !== f);
                } else {
                    activeFeatures.push(f);
                }

                initFeatureToggles();
                // initScatterPlots();
                // initHistograms();
                initDistributionCurves();
                initTrendLines();
                initRidgeline();
            });
    });
}

/* ---------------------------------------------------------
   FEATURE BUBBLE MAP (Dual Chart Factory)
--------------------------------------------------------- */

const bubbleChartConfigs = [
    {
        id: 'A',
        containerId: 'featureBubbleChartA',
        xSelectId: 'bubbleXSelectA',
        ySelectId: 'bubbleYSelectA',
        sizeSelectId: 'bubbleSizeSelectA',
        statSongsId: 'bubbleStatSongsA',
        statXId: 'bubbleStatXA',
        statYId: 'bubbleStatYA',
        statXLabelId: 'bubbleStatXLabelA',
        statYLabelId: 'bubbleStatYLabelA',
        xFeature: 'valence',
        yFeature: 'energy',
        sizeFeature: 'Streams'
    },
    {
        id: 'B',
        containerId: 'featureBubbleChartB',
        xSelectId: 'bubbleXSelectB',
        ySelectId: 'bubbleYSelectB',
        sizeSelectId: 'bubbleSizeSelectB',
        statSongsId: 'bubbleStatSongsB',
        statXId: 'bubbleStatXB',
        statYId: 'bubbleStatYB',
        statXLabelId: 'bubbleStatXLabelB',
        statYLabelId: 'bubbleStatYLabelB',
        xFeature: 'danceability',
        yFeature: 'acousticness',
        sizeFeature: 'Streams'
    }
];

function initFeatureBubbleChart() {
    bubbleChartConfigs.forEach(cfg => initOneBubbleChart(cfg));
}

function initOneBubbleChart(cfg) {
    const containerNode = document.getElementById(cfg.containerId);
    if (!containerNode) return;

    const featuresList = [...allFeatures];
    const sizeOptions = ['Streams', ...featuresList];

    // Populate dropdowns
    [cfg.xSelectId, cfg.ySelectId].forEach(selId => {
        const sel = d3.select('#' + selId);
        sel.selectAll('option').data(featuresList).enter().append('option')
            .text(d => d.replace(/_/g, ' '))
            .attr('value', d => d);
    });
    const sizeSel = d3.select('#' + cfg.sizeSelectId);
    sizeSel.selectAll('option').data(sizeOptions).enter().append('option')
        .text(d => d.replace(/_/g, ' '))
        .attr('value', d => d);

    d3.select('#' + cfg.xSelectId).property('value', cfg.xFeature);
    d3.select('#' + cfg.ySelectId).property('value', cfg.yFeature);
    d3.select('#' + cfg.sizeSelectId).property('value', cfg.sizeFeature);

    d3.select('#' + cfg.xSelectId).on('change', function () { cfg.xFeature = this.value; updateOneBubbleChart(cfg); });
    d3.select('#' + cfg.ySelectId).on('change', function () { cfg.yFeature = this.value; updateOneBubbleChart(cfg); });
    d3.select('#' + cfg.sizeSelectId).on('change', function () { cfg.sizeFeature = this.value; updateOneBubbleChart(cfg); });

    // Build SVG — force square using the container's rendered clientWidth
    const margin = { top: 45, right: 30, bottom: 85, left: 60 };
    const size = containerNode.clientWidth - margin.left - margin.right;
    containerNode.style.height = (size + margin.top + margin.bottom) + 'px';

    const svg = d3.select('#' + cfg.containerId).append('svg')
        .attr('width', size + margin.left + margin.right)
        .attr('height', size + margin.top + margin.bottom)
        .style('display', 'block')
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    cfg.svg = svg;
    cfg.size = size;
    cfg.margin = margin;
    cfg.x = d3.scaleLinear().range([0, size]);
    cfg.y = d3.scaleLinear().range([size, 0]);
    cfg.r = d3.scaleSqrt().range([2, 22]);

    cfg.xAxis = svg.append('g').attr('transform', `translate(0,${size})`).attr('class', 'axis x-axis');
    cfg.yAxis = svg.append('g').attr('class', 'axis y-axis');

    cfg.xLabel = svg.append('text')
        .attr('x', size / 2).attr('y', size + 72)
        .style('text-anchor', 'middle').style('fill', 'rgba(255,255,255,0.85)').style('font-size', '10px').style('letter-spacing', '1px');

    cfg.yLabel = svg.append('text')
        .attr('transform', 'rotate(-90)').attr('x', -size / 2).attr('y', -55)
        .style('text-anchor', 'middle').style('fill', 'rgba(255,255,255,0.85)').style('font-size', '10px').style('letter-spacing', '1px');

    cfg.gridGroup = svg.append('g').attr('class', 'grid-group');

    // Bottom-most level: Invisible overlay for deselecting + quadrant tracking
    svg.append('rect')
        .attr('class', 'bubble-overlay')
        .attr('width', size).attr('height', size)
        .style('fill', 'transparent').style('cursor', 'default')
        .on('mousemove', function (event) {
            // Disabled quadrant glow to follow 'only highlight one bubble at a time' request
        })
        .on('mouseleave', () => { });

    cfg.quadrantGroup = svg.append('g').attr('class', 'quadrant-group');
    cfg.dotGroup = svg.append('g').attr('class', 'dot-group');
    cfg.avgGroup = svg.append('g').attr('class', 'avg-group'); // Crosshair on top

    updateOneBubbleChart(cfg);
}

function applyQuadrantGlow(cfg, qId) {
    if (!cfg.quadrantLabels) return;
    Object.keys(cfg.quadrantLabels).forEach(key => {
        const active = (key === qId);
        const color = cfg.quadrantLabels[key].color;
        cfg.quadrantLabels[key].text
            .style('fill', active ? color : 'rgba(255,255,255,0.35)')
            .style('opacity', active ? 1 : 0.7)
            .style('filter', active ? `drop-shadow(0 0 10px ${color})` : 'none');
        cfg.quadrantLabels[key].rect
            .interrupt()
            .style('fill', color)
            .style('opacity', active ? 0.08 : 0);
    });
}

function updateOneBubbleChart(cfg) {
    if (!cfg.svg || dataset.length === 0) return;

    const xF = cfg.xFeature;
    const yF = cfg.yFeature;
    const sF = cfg.sizeFeature;
    const size = cfg.size;

    // Domains
    cfg.x.domain([featureStats[xF].min, featureStats[xF].max]).nice();
    cfg.y.domain([featureStats[yF].min, featureStats[yF].max]).nice();

    let sExt = sF === 'Streams'
        ? [0, d3.max(originalDataset, d => d.Streams) || 1]
        : [featureStats[sF].min, featureStats[sF].max];
    cfg.r.domain(sExt);

    // Grid
    cfg.gridGroup.selectAll('.grid-line').remove();
    cfg.gridGroup.selectAll('.gx').data(cfg.x.ticks(8)).enter().append('line')
        .attr('class', 'grid-line gx')
        .attr('x1', d => cfg.x(d)).attr('x2', d => cfg.x(d))
        .attr('y1', 0).attr('y2', size)
        .style('stroke', 'rgba(255,255,255,0.05)').style('pointer-events', 'none');
    cfg.gridGroup.selectAll('.gy').data(cfg.y.ticks(8)).enter().append('line')
        .attr('class', 'grid-line gy')
        .attr('x1', 0).attr('x2', size)
        .attr('y1', d => cfg.y(d)).attr('y2', d => cfg.y(d))
        .style('stroke', 'rgba(255,255,255,0.05)').style('pointer-events', 'none');

    cfg.xAxis.transition().duration(globalAnimationDuration).call(d3.axisBottom(cfg.x).ticks(6));
    cfg.yAxis.transition().duration(globalAnimationDuration).call(d3.axisLeft(cfg.y).ticks(6));
    cfg.xLabel.text(xF.replace(/_/g, ' ').toUpperCase());
    cfg.yLabel.text(yF.replace(/_/g, ' ').toUpperCase());

    // Stats
    const activeData = dataset.filter(d => !isNaN(d[xF]) && !isNaN(d[yF]));
    const avgX = d3.mean(activeData, d => d[xF]) || 0;
    const avgY = d3.mean(activeData, d => d[yF]) || 0;
    const fmt = (val, f) => featureStats[f].max > 100 ? d3.format('.0f')(val) : d3.format('.2f')(val);

    d3.select('#' + cfg.statXLabelId).text(xF.substring(0, 3).toUpperCase());
    d3.select('#' + cfg.statYLabelId).text(yF.substring(0, 3).toUpperCase());
    d3.select('#' + cfg.statSongsId).text(activeData.length);
    d3.select('#' + cfg.statXId).text(fmt(avgX, xF));
    d3.select('#' + cfg.statYId).text(fmt(avgY, yF));

    // -- Quadrant Labels (Option D: Fixed labels for specific pairings) --
    cfg.quadrantGroup.selectAll('*').remove();

    let quadrants = null;
    if (xF === 'valence' && yF === 'energy') {
        quadrants = {
            tr: { label: "Euphoric Anthems", color: "#fbbf24" },
            tl: { label: "Dark & Aggressive", color: "#ff4d4d" },
            bl: { label: "Melancholy Heartbreak", color: "#818cf8" },
            br: { label: "Chill & Breezy", color: "#22d3ee" }
        };
    } else if (xF === 'danceability' && yF === 'acousticness') {
        quadrants = {
            tr: { label: "Organic Groove", color: "#10b981" },
            tl: { label: "Intimate Showcase", color: "#f472b6" },
            bl: { label: "Electronic Atmosphere", color: "#a855f7" },
            br: { label: "Synthetic Bangers", color: "#f59e0b" }
        };
    }

    if (quadrants) {
        const qx = cfg.x(0.5);
        const qy = cfg.y(0.5);

        cfg.quadrantGroup.append('line')
            .attr('x1', qx).attr('x2', qx).attr('y1', 0).attr('y2', size)
            .style('stroke', 'rgba(255,255,255,0.1)').style('stroke-dasharray', '5,5');
        cfg.quadrantGroup.append('line')
            .attr('x1', 0).attr('x2', size).attr('y1', qy).attr('y2', qy)
            .style('stroke', 'rgba(255,255,255,0.1)').style('stroke-dasharray', '5,5');

        cfg.quadrantLabels = {};

        const drawQuadrantSet = (qData, xCenter, yPos, anchor, id) => {
            const rect = cfg.quadrantGroup.append('rect')
                .attr('x', id.includes('l') ? 0 : qx)
                .attr('y', id.includes('t') ? 0 : qy)
                .attr('width', id.includes('l') ? qx : size - qx)
                .attr('height', id.includes('t') ? qy : size - qy)
                .style('fill', qData.color)
                .style('opacity', 0)
                .style('cursor', 'pointer');

            const text = cfg.quadrantGroup.append('text')
                .attr('x', xCenter).attr('y', yPos)
                .attr('text-anchor', anchor)
                .style('fill', 'rgba(255,255,255,0.35)')
                .style('transition', 'none')
                .style('font-size', '13px')
                .style('font-weight', '900')
                .style('letter-spacing', '1.5px')
                .style('text-transform', 'uppercase')
                .style('cursor', 'pointer')
                .text(qData.label);

            const handleMouseOver = () => {
                rect.style('opacity', 0.15);
                text.style('fill', 'rgba(255,255,255,1)').style('font-size', '14px');
            };
            const handleMouseOut = () => {
                rect.style('opacity', 0);
                text.style('fill', 'rgba(255,255,255,0.35)').style('font-size', '13px');
            };

            rect.on('mouseover', handleMouseOver).on('mouseout', handleMouseOut);
            text.on('mouseover', handleMouseOver).on('mouseout', handleMouseOut);

            cfg.quadrantLabels[id] = { text, rect, color: qData.color };
        };

        drawQuadrantSet(quadrants.tl, size * 0.25, -20, 'middle', 'tl');
        drawQuadrantSet(quadrants.tr, size * 0.75, -20, 'middle', 'tr');
        drawQuadrantSet(quadrants.bl, size * 0.25, size + 45, 'middle', 'bl');
        drawQuadrantSet(quadrants.br, size * 0.75, size + 45, 'middle', 'br');
    }

    // -- Dots --
    const tTip = d3.select('#tooltip');
    const dots = cfg.dotGroup.selectAll('.feature-bubble').data(dataset, d => d.id || d.Title);

    dots.exit().transition().duration(globalAnimationDuration).attr('r', 0).remove();

    dots.enter().append('circle')
        .attr('class', 'feature-bubble')
        .attr('cx', d => cfg.x(d[xF]))
        .attr('cy', d => cfg.y(d[yF]))
        .attr('r', 0)
        .style('fill', 'var(--accent)')
        .style('stroke', '#fff').style('stroke-width', 0.8)
        .style('opacity', 0.55).style('cursor', 'pointer')
        .on('mouseover', function (event, d) {
            d3.select(this).raise().style('stroke-width', 2.5).style('opacity', 1);
            
            // Focus effect: Dim all other bubbles aggressively
            cfg.dotGroup.selectAll('.feature-bubble')
                .filter(p => p.Title !== d.Title)
                .style('opacity', 0.05);

            // Read live from cfg so the tooltip is always correct after dropdown changes
            const _xF = cfg.xFeature, _yF = cfg.yFeature, _sF = cfg.sizeFeature;
            tTip.transition().duration(200).style('opacity', 1);
            tTip.html(`
                <div class="tooltip-title">${d.Title}</div>
                <div>Artist: ${d.Artist}</div>
                <div style="margin-top:5px;border-top:1px solid rgba(255,255,255,0.1);padding-top:5px;">
                    <div>${featureLabel(_xF)}: <strong style="color:var(--accent)">${formatFeatureVal(_xF, d[_xF])}</strong></div>
                    <div>${featureLabel(_yF)}: <strong style="color:var(--accent)">${formatFeatureVal(_yF, d[_yF])}</strong></div>
                    <div>${featureLabel(_sF)}: <strong>${_sF === 'Streams' ? d3.format(',')(d.Streams) : formatFeatureVal(_sF, d[_sF])}</strong> <span style="font-size:0.65rem;color:rgba(255,255,255,0.45)">(size)</span></div>
                </div>
            `)
                .style('left', (event.pageX + 15) + 'px')
                .style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', function (event, d) {
            // Restore all bubbles to context-aware opacity
            cfg.dotGroup.selectAll('.feature-bubble')
                .style('stroke-width', p => {
                    const isSel = selectedTrack && selectedTrack.Title === p.Title;
                    return isSel ? 2.5 : 0.8;
                })
                .style('opacity', p => {
                    const isSel = selectedTrack && selectedTrack.Title === p.Title;
                    if (selectedTrack) {
                        return isSel ? 1 : 0.15;
                    }
                    return 0.55;
                });

            tTip.transition().duration(500).style('opacity', 0);
        })
        .on('click', function (event, d) {
            selectedTrack = (selectedTrack && selectedTrack.Title === d.Title) ? null : d;
            updateDashboard();
        })
        .merge(dots)
        .transition().duration(globalAnimationDuration)
        .attr('cx', d => cfg.x(d[xF]))
        .attr('cy', d => cfg.y(d[yF]))
        .attr('r', d => cfg.r(sF === 'Streams' ? d.Streams : d[sF]))
        .style('fill', d => (selectedTrack && selectedTrack.Title === d.Title) ? '#ec4899' : 'var(--accent)')
        .style('stroke', d => (selectedTrack && selectedTrack.Title === d.Title) ? '#fff' : '#fff')
        .style('stroke-width', d => (selectedTrack && selectedTrack.Title === d.Title) ? 2.5 : 0.8)
        .style('opacity', d => selectedTrack ? (d.Title === selectedTrack.Title ? 1 : 0.15) : 0.55);

    // -- Average Marker: Radiant Yellow crosshair (Option C) --
    const ax = cfg.x(avgX);
    const ay = cfg.y(avgY);
    const arm = 9;
    const col = '#fff'; // Glowing White

    cfg.avgGroup.selectAll('*').remove();

    const crosshairGroup = cfg.avgGroup.append('g').style('cursor', 'pointer');

    // Horizontal arm of +
    crosshairGroup.append('line')
        .attr('class', 'crosshair-horizontal')
        .attr('x1', ax - arm).attr('x2', ax + arm).attr('y1', ay).attr('y2', ay)
        .style('stroke', col).style('stroke-width', 2.5)
        .style('filter', 'drop-shadow(0 0 5px #fff)');
    // Vertical arm of +
    crosshairGroup.append('line')
        .attr('class', 'crosshair-vertical')
        .attr('x1', ax).attr('x2', ax).attr('y1', ay - arm).attr('y2', ay + arm)
        .style('stroke', col).style('stroke-width', 2.5)
        .style('filter', 'drop-shadow(0 0 5px #fff)');

    // Invisible hit box for easier hovering
    crosshairGroup.append('circle')
        .attr('cx', ax)
        .attr('cy', ay)
        .attr('r', 18)
        .style('fill', 'transparent')
        .on('mouseover', function () {
            crosshairGroup.selectAll('.crosshair-horizontal, .crosshair-vertical')
                .style('stroke-width', 4).style('stroke', '#fff'); // Glow effect on hover

            d3.select('#bubbleStats' + cfg.id)
                .style('background', 'rgba(255, 255, 255, 0.2)')
                .style('box-shadow', '0 4px 15px rgba(255, 255, 255, 0.25)')
                .style('border', '1px solid rgba(255, 255, 255, 0.3)')
                .style('transition', 'all 0.25s ease-out');
        })
        .on('mouseout', function () {
            crosshairGroup.selectAll('.crosshair-horizontal, .crosshair-vertical')
                .style('stroke-width', 2.5).style('stroke', col);

            d3.select('#bubbleStats' + cfg.id)
                .style('background', 'rgba(0,0,0,0.35)')
                .style('box-shadow', 'none')
                .style('border', 'none');
        });
}

function updateFeatureBubbleChart() {
    bubbleChartConfigs.forEach(cfg => updateOneBubbleChart(cfg));
}




/* ---------------------------------------------------------
   SCATTER PLOTS (Grid Configuration)
--------------------------------------------------------- */
let scatterCharts = {};

/* ---------------------------------------------------------
   FEATURE DISTRIBUTION CURVES (KDE)
--------------------------------------------------------- */
let distributionCharts = {};

function kernelDensityEstimator(kernel, X) {
    return function (V) {
        return X.map(x => [x, d3.mean(V, v => kernel(x - v))]);
    };
}
function kernelEpanechnikov(k) {
    return v => Math.abs(v /= k) <= 1 ? 0.75 * (1 - v * v) / k : 0;
}

function initDistributionCurves() {
    const grid = d3.select("#scatterGrid");
    grid.html("");
    distributionCharts = {};

    activeFeatures.forEach(feature => {
        const item = grid.append("div").attr("class", "scatter-plot-item dist-curve-item");
        item.append("h3").text(featureLabel(feature));
        const divId = "dist-" + feature;
        item.append("div").attr("id", divId).style("height", "230px").style("width", "100%");

        const svgContainer = d3.select("#" + divId);
        const margin = { top: 25, right: 15, bottom: 30, left: 35 };
        const width = 350; // Fixed internal coordinate width
        const height = 200; // Fixed internal coordinate height

        const svg = svgContainer.append("svg")
            .attr("width", "100%")
            .attr("height", "100%")
            .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
            .attr("preserveAspectRatio", "xMidYMid meet")
            .append("g")
            .attr("transform", `translate(${margin.left}, ${margin.top})`);

        const x = d3.scaleLinear().domain([featureStats[feature].min, featureStats[feature].max]).range([0, width]);
        const y = d3.scaleLinear().range([height, 0]);

        const xAxis = svg.append("g").attr("class", "axis x-axis").attr("transform", `translate(0, ${height})`);
        const yAxis = svg.append("g").attr("class", "axis y-axis");

        const curveArea = svg.append("path").attr("class", "curve-area").attr("fill", "var(--accent)").attr("opacity", 0.2);
        const curveLine = svg.append("path").attr("class", "curve-line").attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", "2.5px");
        const sweetSpotGroup = svg.append("g").attr("class", "sweet-spot-group");

        // Vertical Crosshair and Focal Point
        const crosshair = svg.append("line").attr("class", "dist-crosshair").attr("stroke", "rgba(255,255,255,0.4)").attr("stroke-width", "1px").attr("y1", 0).attr("y2", height).style("opacity", 0).style("pointer-events", "none");
        const focusPoint = svg.append("circle").attr("class", "dist-focus-point").attr("r", 5).attr("fill", "var(--accent)").attr("stroke", "#fff").attr("stroke-width", "1.5px").style("opacity", 0).style("pointer-events", "none");

        // Transparent overlay for mouse tracking
        svg.append("rect")
            .attr("width", width)
            .attr("height", height)
            .attr("fill", "transparent")
            .style("pointer-events", "all")
            .on("mousemove", function (event) {
                const [mx] = d3.pointer(event);
                const val = x.invert(mx);

                // Find density at this X using distribution data stored in chart
                const chartData = distributionCharts[feature].currentDensity;
                if (!chartData) return;

                // Bisect or find nearest point in KDE density array
                const bisect = d3.bisector(d => d[0]).left;
                const idx = bisect(chartData, val);
                const d = chartData[idx] || chartData[chartData.length - 1];

                crosshair.attr("x1", mx).attr("x2", mx).style("opacity", 1);
                focusPoint.attr("cx", mx).attr("cy", y(d[1])).style("opacity", 1);

                const tooltip = d3.select("#tooltip");
                tooltip.transition().duration(50).style("opacity", 1);
                tooltip.html(`
                    <div class="tooltip-title">${featureLabel(feature)} Scout</div>
                    <div style="font-size: 1.1rem;">Value: <strong>${d3.format(".2f")(d[0])}</strong></div>
                    <div style="font-size: 0.8rem; opacity: 0.6; margin-top: 5px;">Rel. Density: ${d3.format(".3f")(d[1])}</div>
                `)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseleave", () => {
                crosshair.style("opacity", 0);
                focusPoint.style("opacity", 0);
                d3.select("#tooltip").transition().duration(500).style("opacity", 0);
            });

        distributionCharts[feature] = { svg, x, y, xAxis, yAxis, curveArea, curveLine, sweetSpotGroup, width, height };
    });

    updateDistributionCurves();
}

function updateDistributionCurves() {
    const featureDensities = {};
    let globalMaxDensity = 0;

    // First pass: Compute all densities and find the GLOBAL MAX for synchronized Y-axis
    activeFeatures.forEach(feature => {
        const chart = distributionCharts[feature];
        if (!chart) return;

        const dataForFeature = dataset.map(d => +d[feature]).filter(v => !isNaN(v));
        const kde = kernelDensityEstimator(kernelEpanechnikov(0.12), chart.x.ticks(60));
        const density = kde(dataForFeature);
        featureDensities[feature] = density;
        chart.currentDensity = density; // Store for interactive mouseover

        const localMax = d3.max(density, d => d[1]) || 0;
        if (localMax > globalMaxDensity) globalMaxDensity = localMax;
    });

    // Second pass: Update visuals with the synchronized Y-scale
    activeFeatures.forEach(feature => {
        const chart = distributionCharts[feature];
        const density = featureDensities[feature];
        if (!chart || !density) return;

        chart.y.domain([0, globalMaxDensity]).nice();

        chart.xAxis.call(d3.axisBottom(chart.x).ticks(5));
        chart.yAxis.transition().duration(400).call(d3.axisLeft(chart.y).ticks(4));

        const areaGenerator = d3.area()
            .curve(d3.curveBasis)
            .x(d => chart.x(d[0]))
            .y0(chart.height)
            .y1(d => chart.y(d[1]));

        const lineGenerator = d3.line()
            .curve(d3.curveBasis)
            .x(d => chart.x(d[0]))
            .y(d => chart.y(d[1]));

        chart.curveArea.datum(density).transition().duration(globalAnimationDuration).attr("d", areaGenerator);
        chart.curveLine.datum(density).transition().duration(globalAnimationDuration).attr("d", lineGenerator);

        // Sweet Spot (Mean) - White & Bring to Front
        const meanVal = d3.mean(dataset, d => +d[feature]);
        chart.sweetSpotGroup.selectAll("*").remove();

        if (meanVal !== undefined && !isNaN(meanVal)) {
            const sx = chart.x(meanVal);
            const sweetSpotCol = "#fff"; // Plain White

            chart.sweetSpotGroup.append("line")
                .attr("x1", sx).attr("x2", sx)
                .attr("y1", 0).attr("y2", chart.height)
                .attr("stroke", sweetSpotCol)
                .attr("stroke-width", "2px")
                .attr("stroke-dasharray", "4,2")
                .style("opacity", 0.85);

            chart.sweetSpotGroup.append("text")
                .attr("x", sx + 5)
                .attr("y", 15)
                .style("fill", sweetSpotCol)
                .style("font-size", "14px")
                .style("font-weight", "900")
                .style("text-transform", "uppercase")
                .text(d3.format(".2f")(meanVal))
                .on("mouseover", function (event) {
                    const tooltip = d3.select("#tooltip");
                    tooltip.transition().duration(200).style("opacity", 1);
                    tooltip.html(`
                        <div class="tooltip-title" style="color: ${sweetSpotCol};">Statistical Sweet Spot (μ)</div>
                        <div style="font-size: 1.1rem;">Mean: <strong>${d3.format(".2f")(meanVal)}</strong></div>
                        <div style="font-size: 0.8rem; opacity:0.6; margin-top:5px;">Center of the Prototype Hit Song profile for this era.</div>
                    `)
                        .style("left", (event.pageX + 15) + "px")
                        .style("top", (event.pageY - 28) + "px");
                })
                .on("mouseout", () => d3.select("#tooltip").transition().duration(500).style("opacity", 0));
        }
    });
}

/* Original Histogram Logic (Commented Out for Preservation)
    const grid = d3.select("#scatterGrid");
    grid.html("");
    histogramCharts = {};

    activeFeatures.forEach(feature => {
        const item = grid.append("div").attr("class", "scatter-plot-item histogram-item");
        item.append("h3").text(featureLabel(feature));
        const divId = "hist-" + feature;
        item.append("div").attr("id", divId).style("height", "220px").style("width", "100%");

        const svgContainer = d3.select("#" + divId);
        const containerNode = document.getElementById(divId);
        const margin = { top: 10, right: 10, bottom: 25, left: 35 };
        const width = containerNode.clientWidth - margin.left - margin.right;
        const height = containerNode.clientHeight - margin.top - margin.bottom;

        const svg = svgContainer.append("svg")
            .attr("width", "100%")
            .attr("height", "100%")
            .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
            .append("g")
            .attr("transform", `translate(${margin.left}, ${margin.top})`);

        const x = d3.scaleLinear().domain([featureStats[feature].min, featureStats[feature].max]).range([0, width]);
        const y = d3.scaleLinear().range([height, 0]);

        const xAxis = svg.append("g").attr("class", "axis x-axis").attr("transform", `translate(0, ${height})`);
        const yAxis = svg.append("g").attr("class", "axis y-axis");

        const barGroup = svg.append("g").attr("class", "bar-group");
        const sweetSpotGroup = svg.append("g").attr("class", "sweet-spot-group");

        histogramCharts[feature] = { svg, x, y, xAxis, yAxis, barGroup, sweetSpotGroup, width, height };
    });

    updateHistograms();
}

function updateHistograms() {
    activeFeatures.forEach(feature => {
        const chart = histogramCharts[feature];
        if (!chart) return;

        const dataForFeature = dataset.map(d => +d[feature]).filter(v => !isNaN(v));
        const thresholds = chart.x.ticks(25);
        const bins = d3.bin().domain(chart.x.domain()).thresholds(thresholds)(dataForFeature);

        chart.y.domain([0, d3.max(bins, d => d.length)]).nice();

        chart.xAxis.call(d3.axisBottom(chart.x).ticks(5));
        chart.yAxis.transition().duration(400).call(d3.axisLeft(chart.y).ticks(4));

        const bars = chart.barGroup.selectAll(".hist-bar").data(bins);

        bars.exit().transition().duration(400).attr("height", 0).attr("y", chart.height).remove();

        bars.enter().append("rect")
            .attr("class", "hist-bar")
            .attr("x", d => chart.x(d.x0) + 1)
            .attr("width", d => Math.max(0, chart.x(d.x1) - chart.x(d.x0) - 1))
            .attr("y", chart.height)
            .attr("height", 0)
            .attr("fill", "var(--accent)")
            .attr("opacity", 0.6)
            .on("mouseover", function(event, d) {
                d3.select(this).attr("opacity", 0.9).style("filter", "brightness(1.3)");
                const tooltip = d3.select("#tooltip");
                tooltip.transition().duration(200).style("opacity", 1);
                tooltip.html(`
                    <div class="tooltip-title">${featureLabel(feature)} Range</div>
                    <div>${d3.format(".2f")(d.x0)} - ${d3.format(".2f")(d.x1)}</div>
                    <div style="font-size: 1.1rem; margin-top: 5px;"><strong>${d.length} Tracks</strong></div>
                `)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", function() {
                d3.select(this).attr("opacity", 0.6).style("filter", "none");
                d3.select("#tooltip").transition().duration(500).style("opacity", 0);
            })
            .merge(bars)
            .transition().duration(globalAnimationDuration)
            .attr("x", d => chart.x(d.x0) + 1)
            .attr("width", d => Math.max(0, chart.x(d.x1) - chart.x(d.x0) - 1))
            .attr("y", d => chart.y(d.length))
            .attr("height", d => chart.height - chart.y(d.length));

        // Sweet Spot (Mean)
        const meanVal = d3.mean(dataForFeature);
        chart.sweetSpotGroup.selectAll("*").remove();

        if (meanVal !== undefined) {
            const sx = chart.x(meanVal);
            
            // Vertical line
            chart.sweetSpotGroup.append("line")
                .attr("x1", sx).attr("x2", sx)
                .attr("y1", 0).attr("y2", chart.height)
                .attr("stroke", "#a855f7")
                .attr("stroke-width", "2px")
                .attr("stroke-dasharray", "4,2")
                .style("opacity", 0.8);

            // Mu Marker
            chart.sweetSpotGroup.append("text")
                .attr("x", sx)
                .attr("y", -5)
                .attr("text-anchor", "middle")
                .style("fill", "#d8b4fe")
                .style("font-size", "14px")
                .style("font-weight", "bold")
                .text("μ")
                .on("mouseover", function(event) {
                    const tooltip = d3.select("#tooltip");
                    tooltip.transition().duration(200).style("opacity", 1);
                    tooltip.html(`
                        <div class="tooltip-title" style="color: #d8b4fe;">Statistical Sweet Spot (μ)</div>
                        <div style="font-size: 1.1rem;">Mean: <strong>${d3.format(".2f")(meanVal)}</strong></div>
                        <div style="font-size: 0.8rem; opacity:0.6; margin-top:5px;">Center of the Prototype Hit Song profile for this era.</div>
                    `)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
                })
                .on("mouseout", () => d3.select("#tooltip").transition().duration(500).style("opacity", 0));
        }
    });
}

/* Original Scatter Plot Logic (Commented Out for Preservation)
    const grid = d3.select("#scatterGrid");
    grid.html("");
    scatterCharts = {};

    // Pass 1: Create all containers so CSS grid balances them
    activeFeatures.forEach(feature => {
        const item = grid.append("div").attr("class", "scatter-plot-item");
        item.append("h3").text(featureLabel(feature));
        item.append("div").attr("id", "scatter-" + feature).style("height", "220px").style("width", "100%");
    });

    // Pass 2: Measure actual stable sizes and create SVGs
    activeFeatures.forEach(feature => {
        const divId = "scatter-" + feature;
        const svgContainer = d3.select("#" + divId);
        const containerNode = document.getElementById(divId);
        const margin = { top: 10, right: 10, bottom: 25, left: 35 };
        const width = containerNode.clientWidth - margin.left - margin.right;
        const height = containerNode.clientHeight - margin.top - margin.bottom;

        const svg = svgContainer.append("svg")
            .attr("width", "100%")
            .attr("height", "100%")
            .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
            .style("overflow", "hidden")
            .append("g")
            .attr("transform", `translate(${margin.left}, ${margin.top})`);

        // Add clip path for the data region to prevent dots overlapping axes
        svg.append("defs").append("clipPath")
            .attr("id", "clip-" + feature)
            .append("rect")
            .attr("width", width)
            .attr("height", height);

        const x = d3.scaleLinear().range([0, width]);
        const y = d3.scaleLinear().range([height, 0]);

        const xAxis = svg.append("g").attr("class", "axis x-axis").attr("transform", `translate(0, ${height})`);
        const yAxis = svg.append("g").attr("class", "axis y-axis");

        const contourGroup = svg.append("g").attr("class", "contour-group").attr("clip-path", `url(#clip-${feature})`);
        const dotGroup = svg.append("g").attr("class", "dot-group").attr("clip-path", `url(#clip-${feature})`);
        const sweetSpotGroup = svg.append("g").attr("class", "sweet-spot-group").attr("clip-path", `url(#clip-${feature})`);

        scatterCharts[feature] = { svg, x, y, xAxis, yAxis, dotGroup, contourGroup, sweetSpotGroup, width, height };
    });

    updateScatterPlots();
}

function updateScatterPlots() {
    activeFeatures.forEach(feature => {
        const chart = scatterCharts[feature];
        if (!chart) return;

        const dataToPlot = dataset.filter(d => !isNaN(d[feature]) && d.Streams > 0);

        // Lock axes globally to strictly prevent jumping when dataset shrinks in size/scope
        const globalMaxStreams = d3.max(originalDataset, d => d.Streams) || 1;
        chart.x.domain([0, globalMaxStreams]).nice();
        chart.y.domain([featureStats[feature].min, featureStats[feature].max]).nice();

        chart.xAxis.call(d3.axisBottom(chart.x).ticks(5).tickFormat(d3.format(".2s")));
        chart.yAxis.call(d3.axisLeft(chart.y).ticks(4));

        // Draw Goldilocks Heatmap (Contours)
        const densityData = d3.contourDensity()
            .x(d => chart.x(d.Streams))
            .y(d => chart.y(d[feature]))
            .size([chart.width, chart.height])
            .bandwidth(20) // controls the smoothness of the glowing spot
            (dataToPlot);

        chart.contourGroup.selectAll("path").remove();
        chart.sweetSpotGroup.selectAll(".sweet-spot-marker").remove();

        if (densityData.length > 0) {
            chart.contourGroup.selectAll("path")
                .data(densityData)
                .enter().append("path")
                .attr("class", "contour")
                .attr("fill", "var(--accent)")
                .attr("opacity", d => d.value * 0.8) // scales opacity by density weight
                .attr("d", d3.geoPath());

            // Label the sweetest spot (the contour with highest density threshold)
            const maxContour = densityData[densityData.length - 1];
            const [cx, cy] = d3.geoPath().centroid(maxContour);

            if (!isNaN(cx) && !isNaN(cy)) {
                // Find mathematically nearest track to this exact centroid peak
                let nearestTrack = null;
                let minDist = Infinity;

                dataToPlot.forEach(d => {
                    let dx = cx - chart.x(d.Streams);
                    let dy = cy - chart.y(d[feature]);
                    let dist = dx * dx + dy * dy;
                    if (dist < minDist) {
                        minDist = dist;
                        nearestTrack = d;
                    }
                });

                chart.sweetSpotGroup.append("circle")
                    .attr("class", "sweet-spot-marker")
                    .attr("cx", cx)
                    .attr("cy", cy)
                    .attr("r", 6)
                    .style("fill", "#a855f7") // Glowing purple
                    .style("stroke", "#fff")
                    .style("stroke-width", "1.5px")
                    .style("filter", "drop-shadow(0 0 6px #a855f7)")
                    .style("cursor", "pointer")
                    .on("mouseover", function (event) {
                        d3.select(this).attr("r", 8).style("stroke-width", "2px");

                        const tooltip = d3.select("#tooltip");
                        tooltip.transition().duration(200).style("opacity", 1);
                        tooltip.html(`
                            <div class="tooltip-title" style="color: #d8b4fe; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 5px; margin-bottom: 5px;">The Sweet Spot</div>
                            <div style="font-size: 0.9rem; margin-bottom: 4px;">${feature.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}: <strong style="color: #d8b4fe">${d3.format(".2f")(chart.y.invert(cy))}</strong></div>
                            <div>Nearest Hit: <strong>${nearestTrack.Title}</strong></div>
                            <div style="font-size: 0.8rem; margin-top: 5px; color: #a3a3a3;">Streams Context: ${d3.format(",.0f")(chart.x.invert(cx))}</div>
                        `)
                            .style("left", (event.pageX + 15) + "px")
                            .style("top", (event.pageY - 28) + "px");
                    })
                    .on("mouseout", function () {
                        d3.select(this).attr("r", 6).style("stroke-width", "1.5px");
                        d3.select("#tooltip").transition().duration(500).style("opacity", 0);
                    });
            }
        }

        const dots = chart.dotGroup.selectAll(".scatter-dot").data(dataToPlot, d => d.id || d.Title);
        const tooltip = d3.select("#tooltip");

        dots.enter()
            .append("circle")
            .attr("class", "scatter-dot")
            .attr("r", 3.5)
            .attr("cx", chart.x(0))
            .attr("cy", d => chart.y(d[feature]))
            .on("mouseover", function (event, d) {
                d3.selectAll(".scatter-dot").filter(dot => dot.Title === d.Title)
                    .style("fill", "var(--accent)").style("stroke", "#fff").attr("r", 4);

                tooltip.transition().duration(200).style("opacity", 1);
                tooltip.html(`
                    <div class="tooltip-title">${d.Title}</div>
                    <div>Artist: ${d.Artist}</div>
                    <div>Streams: ${d3.format(",")(d.Streams)}</div>
                    <div>${featureLabel(feature)}: <strong>${formatFeatureVal(feature, d[feature])}</strong></div>
                `)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", function (event, d) {
                const isSelected = selectedTrack && selectedTrack.Title === d.Title;
                d3.selectAll(".scatter-dot").filter(dot => dot.Title === d.Title)
                    .style("fill", isSelected ? "var(--accent)" : "")
                    .style("stroke", isSelected ? "#fff" : "")
                    .attr("r", isSelected ? 6 : 3.5);
                tooltip.transition().duration(500).style("opacity", 0);
            })
            .on("click", function (event, d) {
                if (selectedTrack && selectedTrack.Title === d.Title) {
                    selectedTrack = null;
                    d3.select("#songDropdown").property("value", "");
                } else {
                    selectedTrack = d;
                    const opt = d3.select("#songDropdown").selectAll("option").filter((o, i) => o && (o === d || o.id === d.id || o.Title === d.Title)).node();
                    if (opt) d3.select("#songDropdown").property("value", opt.value);
                }
                updateDashboard();
            })
            .merge(dots)
            .transition().duration(globalAnimationDuration)
            .attr("cx", d => chart.x(d.Streams))
            .attr("cy", d => chart.y(d[feature]))
            .attr("r", d => (selectedTrack && d.Title === selectedTrack.Title) ? 6 : 3.5)
            .style("stroke-width", d => (selectedTrack && d.Title === selectedTrack.Title) ? 2 : 1)
            .style("fill", d => (selectedTrack && d.Title === selectedTrack.Title) ? "var(--accent)" : "")
            .style("stroke", d => (selectedTrack && d.Title === selectedTrack.Title) ? "#fff" : "")
            .style("opacity", d => selectedTrack ? (d.Title === selectedTrack.Title ? 1 : 0.15) : 1);

        dots.exit().remove();
    });
}
*/

/* ---------------------------------------------------------
   RADAR CHART
--------------------------------------------------------- */
let radarSvg, radarConfig;

function initRadarChart() {
    radarConfig = {
        w: 250,
        h: 250,
        margin: { top: 40, right: 60, bottom: 40, left: 60 },
        levels: 5,
        maxValue: 1,
        labelFactor: 1.25,
        opacityArea: 0.35,
        dotRadius: 4,
        opacityCircles: 0.1,
        strokeWidth: 2,
        roundStrokes: false
    };
    buildRadarLayout();
    updateRadarChart();
}

function buildRadarLayout() {
    const container = document.getElementById("radarChartContainer");
    radarConfig.w = Math.min(container.clientWidth - radarConfig.margin.left - radarConfig.margin.right, 450);
    radarConfig.h = radarConfig.w;

    d3.select("#radarChartContainer").select("svg").remove();

    radarSvg = d3.select("#radarChartContainer")
        .append("svg")
        .attr("width", radarConfig.w + radarConfig.margin.left + radarConfig.margin.right)
        .attr("height", radarConfig.h + radarConfig.margin.top + radarConfig.margin.bottom)
        .append("g")
        .attr("transform", "translate(" + (radarConfig.w / 2 + radarConfig.margin.left) + "," + (radarConfig.h / 2 + radarConfig.margin.top) + ")");
}

function getNormalizedRadarData(trackObj) {
    return audioMetrics.map(f => {
        let val = trackObj[f];
        let normVal = normalize(val, featureStats[f].min, featureStats[f].max);
        return { axis: f, value: normVal, originalValue: val };
    });
}

function updateRadarChart() {
    const data = [];

    // Average
    const avgData = audioMetrics.map(f => {
        let normVal = normalize(globalAverages[f], featureStats[f].min, featureStats[f].max);
        return { axis: f, value: normVal, originalValue: globalAverages[f] };
    });
    data.push(avgData);

    if (selectedTrack) {
        data.push(getNormalizedRadarData(selectedTrack));
    }

    drawRadarChart(data);
}

function drawRadarChart(data) {
    const allAxis = audioMetrics.map(f => featureLabel(f)),
        total = allAxis.length,
        radius = Math.min(radarConfig.w / 2, radarConfig.h / 2),
        angleSlice = Math.PI * 2 / total;

    const rScale = d3.scaleLinear()
        .range([0, radius])
        .domain([0, radarConfig.maxValue]);

    radarSvg.selectAll(".radarWrapper").remove();
    radarSvg.selectAll(".axisWrapper").remove();

    const axisGrid = radarSvg.append("g").attr("class", "axisWrapper");

    axisGrid.selectAll(".levels")
        .data(d3.range(1, (radarConfig.levels + 1)).reverse())
        .enter()
        .append("circle")
        .attr("class", "gridCircle")
        .attr("r", d => radius / radarConfig.levels * d)
        .style("fill", "#CDCDCD")
        .style("stroke", "#CDCDCD")
        .style("fill-opacity", radarConfig.opacityCircles)
        .style("stroke-dasharray", "4,3");

    const axis = axisGrid.selectAll(".axis")
        .data(allAxis)
        .enter()
        .append("g")
        .attr("class", "axis");

    axis.append("line")
        .attr("x1", 0)
        .attr("y1", 0)
        .attr("x2", (d, i) => rScale(radarConfig.maxValue * 1.05) * Math.cos(angleSlice * i - Math.PI / 2))
        .attr("y2", (d, i) => rScale(radarConfig.maxValue * 1.05) * Math.sin(angleSlice * i - Math.PI / 2))
        .attr("class", "line")
        .style("stroke", "rgba(255, 255, 255, 0.1)")
        .style("stroke-width", "1px");

    axis.append("text")
        .attr("class", "legend")
        .style("font-size", "10px")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .attr("x", (d, i) => rScale(radarConfig.maxValue * radarConfig.labelFactor) * Math.cos(angleSlice * i - Math.PI / 2))
        .attr("y", (d, i) => rScale(radarConfig.maxValue * radarConfig.labelFactor) * Math.sin(angleSlice * i - Math.PI / 2))
        .text(d => d)
        .style("fill", "var(--text-primary)");

    const g = radarSvg.append("g").attr("class", "radarWrapper");

    const radarLine = d3.lineRadial()
        .curve(d3.curveLinearClosed)
        .radius(d => rScale(d.value))
        .angle((d, i) => i * angleSlice);

    if (radarConfig.roundStrokes) {
        radarLine.curve(d3.curveCardinalClosed);
    }

    const blobWrapper = g.selectAll(".radar-blob")
        .data(data)
        .enter().append("g")
        .attr("class", "radar-blob");

    const getStroke = (i) => i === 0 ? "var(--avg-stroke)" : "var(--sel-stroke)";
    const getFill = (i) => i === 0 ? "var(--avg-color)" : "var(--sel-color)";

    blobWrapper.append("path")
        .attr("class", "radarArea")
        .style("fill", (d, i) => getFill(i))
        .style("fill-opacity", radarConfig.opacityArea)
        .transition().duration(globalAnimationDuration)
        .attr("d", d => radarLine(d));

    blobWrapper.selectAll(".radarArea")
        .on('mouseover', function (event, d) {
            d3.selectAll(".radarArea").transition().duration(200).style("fill-opacity", 0.1);
            d3.select(this).transition().duration(200).style("fill-opacity", 0.7);

            const isAvg = d3.select(this.parentNode).datum() === data[0];
            let htmlContent = `<div class="tooltip-title" style="margin-bottom: 5px;">${isAvg ? "Average Profile" : (selectedTrack ? selectedTrack.Title : "Profile")}</div>`;

            d.forEach(feature => {
                const valColor = isAvg ? "#38bdf8" : "#f472b6"; // Bright sky blue / hot pink for ultra-high contrast
                htmlContent += `<div style="font-size: 11px; text-transform: capitalize; margin-bottom: 2px;">
                    <span style="opacity: 0.9;">${feature.axis}:</span> 
                    <strong style="color: ${valColor}; font-size: 12px; margin-left: 4px;">${d3.format(".2f")(feature.value)}</strong>
                </div>`;
            });

            d3.select("#tooltip").html(htmlContent)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px")
                .transition().duration(200).style("opacity", 1);
        })
        .on('mousemove', function (event) {
            d3.select("#tooltip")
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on('mouseout', function () {
            d3.selectAll(".radarArea").transition().duration(200).style("fill-opacity", radarConfig.opacityArea);
            d3.select("#tooltip").transition().duration(200).style("opacity", 0);
        });

    blobWrapper.append("path")
        .attr("class", "radarStroke")
        .attr("d", d => radarLine(d))
        .style("stroke-width", radarConfig.strokeWidth + "px")
        .style("stroke", (d, i) => getStroke(i))
        .style("fill", "none");

    const tooltip = d3.select("#tooltip");

    blobWrapper.selectAll(".radarCircle")
        .data(d => d)
        .enter().append("circle")
        .attr("class", "radarCircle")
        .attr("r", radarConfig.dotRadius)
        .attr("cx", (d, i) => rScale(d.value) * Math.cos(angleSlice * i - Math.PI / 2))
        .attr("cy", (d, i) => rScale(d.value) * Math.sin(angleSlice * i - Math.PI / 2))
        .style("fill", function () {
            const parentData = d3.select(this.parentNode).datum();
            return getStroke(data.indexOf(parentData));
        })
        .style("fill-opacity", 0.8)
        .on("mouseover", function (event, d) {
            d3.select(this).attr("r", 6).style("fill", "#fff");
            tooltip.transition().duration(200).style("opacity", 1);
            tooltip.html(`
                <div class="tooltip-title">${d.axis.charAt(0).toUpperCase() + d.axis.slice(1)}</div>
                <div>Actual Value: <strong>${d3.format(".2f")(d.originalValue)}</strong></div>
            `)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function (event, d) {
            const parentData = d3.select(this.parentNode).datum();
            d3.select(this).attr("r", radarConfig.dotRadius).style("fill", getStroke(data.indexOf(parentData)));
            tooltip.transition().duration(500).style("opacity", 0);
        });
}

/* ---------------------------------------------------------
   BUBBLE CHART (Drill-Down Flat Packing)
--------------------------------------------------------- */
function initBubbleChart() {
    const container = document.getElementById("bubbleChartContainer");
    const width = container.clientWidth;
    const height = Math.max(container.clientHeight, 400);

    d3.select("#bubbleChartContainer").selectAll("*").remove();
    if (dataset.length === 0) return;

    const svg = d3.select("#bubbleChartContainer").append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .style("display", "block")
        .style("background", "transparent");

    const g = svg.append("g");

    function renderArtists() {
        g.selectAll("*").remove();

        const artistGroups = Array.from(d3.group(dataset, d => d.Artist), ([artist, songs]) => ({
            name: artist,
            value: d3.sum(songs, s => s.Streams), // Larger by streams to size them nicely across
            songCount: songs.length,
            songs: songs
        }));

        // Expose function for external charts to natively trigger this drill-down logic
        window.triggerBubbleArtistView = function (artistName) {
            const data = artistGroups.find(a => a.name === artistName);
            if (data) renderSongs(data);
        };

        const pack = d3.pack()
            .size([width, height])
            .padding(4);

        const root = pack(d3.hierarchy({ children: artistGroups }).sum(d => Math.max(d.value, 1)));

        const node = g.selectAll(".artistNode")
            .data(root.leaves())
            .join("g")
            .attr("class", "artistNode")
            .attr("transform", d => `translate(${d.x},${d.y})`)
            .style("cursor", "pointer")
            .on("click", (event, d) => {
                renderSongs(d.data);
            });

        node.append("circle")
            .attr("r", d => d.r)
            .attr("class", d => "bubble-node-" + safeId(d.data.name))
            .style("fill", d => colorScale(d.data.name))
            .style("opacity", 0.75)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1)
            .on("mouseover", function (event, d) {
                d3.select(this).style("opacity", 1).attr("stroke-width", 2);
                d3.selectAll(".bar-node-" + safeId(d.data.name)).select("rect").style("filter", "brightness(1.5)");
            })
            .on("mouseout", function (event, d) {
                d3.select(this).style("opacity", 0.75).attr("stroke-width", 1);
                d3.selectAll(".bar-node-" + safeId(d.data.name)).select("rect").style("filter", "none");
            });

        const tooltip = d3.select("#tooltip");
        node.on("mousemove", function (event, d) {
            tooltip.transition().duration(200).style("opacity", 1);
            tooltip.html(`
                <div class="tooltip-title">${d.data.name}</div>
                <div>Top Tracks Count: ${d.data.songCount}</div>
                <div>Total Streams: ${d3.format(".2s")(d.data.value)}</div>
            `)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        }).on("mouseleave", function () {
            tooltip.transition().duration(500).style("opacity", 0);
        });

        node.append("text")
            .style("font-size", d => Math.min(14, d.r / 3 + 2) + "px")
            .style("fill", "#fff")
            .style("text-anchor", "middle")
            .style("text-shadow", "1px 1px 2px #000")
            .style("pointer-events", "none")
            .attr("dy", "0.3em")
            .text(d => d.data.name.length > Math.max(d.r / 3, 5) ? d.data.name.substring(0, Math.max(d.r / 3, 5)) + ".." : d.data.name);
    }

    function renderSongs(artistData) {
        g.selectAll("*").remove();

        const songsData = artistData.songs.map(s => ({
            name: s.Title,
            value: s.Streams || 1,
            data: s
        }));

        const pack = d3.pack().size([width, height]).padding(4);
        const root = pack(d3.hierarchy({ children: songsData }).sum(d => Math.max(d.value, 1)));

        // Back button
        const backBtn = svg.append("g")
            .attr("transform", "translate(20, 20)")
            .style("cursor", "pointer")
            .on("click", () => {
                backBtn.remove();
                renderArtists();
            });

        backBtn.append("rect")
            .attr("width", 80).attr("height", 30)
            .attr("rx", 5).style("fill", "var(--accent)");
        backBtn.append("text")
            .text("← Back")
            .attr("x", 40).attr("y", 20)
            .style("fill", "#fff").style("text-anchor", "middle").style("font-weight", "bold");

        const node = g.selectAll(".songNode")
            .data(root.leaves())
            .join("g")
            .attr("class", "songNode")
            .attr("transform", d => `translate(${d.x},${d.y})`)
            .style("cursor", "pointer")
            .on("click", (event, d) => {
                if (selectedTrack && selectedTrack.Title === d.data.data.Title) {
                    selectedTrack = null;
                    d3.select("#songDropdown").property("value", "");
                } else {
                    selectedTrack = d.data.data;
                    const opt = d3.select("#songDropdown").selectAll("option").filter((o, i) => o && (selectedTrack.id === o.id || selectedTrack.Title === o.Title)).node();
                    if (opt) d3.select("#songDropdown").property("value", opt.value);
                }
                updateDashboard();
                event.stopPropagation();
            });

        node.append("circle")
            .attr("r", d => d.r)
            .style("fill", colorScale(artistData.name)) // Reuse parent artist color
            .style("opacity", d => (selectedTrack && selectedTrack.Title === d.data.data.Title) ? 1 : 0.6)
            .attr("stroke", "#fff")
            .attr("stroke-width", d => (selectedTrack && selectedTrack.Title === d.data.data.Title) ? 3 : 1)
            .on("mouseover", function () { d3.select(this).style("opacity", 1); })
            .on("mouseout", function (event, d) {
                const isSel = selectedTrack && selectedTrack.Title === d.data.data.Title;
                d3.select(this).style("opacity", isSel ? 1 : 0.6);
            });

        node.append("text")
            .style("font-size", d => Math.min(12, d.r / 3 + 2) + "px")
            .style("fill", "#fff")
            .style("text-anchor", "middle")
            .style("pointer-events", "none")
            .attr("dy", "0.3em")
            .text(d => d.data.name.length > Math.max(d.r / 4, 5) ? d.data.name.substring(0, Math.max(d.r / 4, 5)) + ".." : d.data.name);

        const tooltip = d3.select("#tooltip");
        node.on("mousemove", function (event, d) {
            tooltip.transition().duration(200).style("opacity", 1);
            tooltip.html(`
                <div class="tooltip-title">${d.data.name}</div>
                <div>Streams: ${d3.format(",")(d.data.value)}</div>
            `)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        }).on("mouseleave", function () {
            tooltip.transition().duration(500).style("opacity", 0);
        });
    }

    renderArtists();
}

/* ---------------------------------------------------------
   ARTIST BAR CHART RACE
--------------------------------------------------------- */
let artistBarData = {};
let topNArtistsCount = 10;

function initArtistBarChart() {
    const container = d3.select("#artistBarChartContainer");
    if (container.empty()) return;
    container.html("");

    // Listen to our custom dropdown
    d3.select("#topNArtistsSelect").on("change", function () {
        topNArtistsCount = parseInt(this.value) || 10;
        updateArtistBarChart();
    });

    const margin = { top: 10, right: 20, bottom: 20, left: 100 }; // wide left for artist names
    const width = document.getElementById("artistBarChartContainer").clientWidth - margin.left - margin.right;

    // Default initial height calculation
    const height = Math.max(320 - margin.top - margin.bottom, topNArtistsCount * 28);

    const svg = container.append("svg")
        .attr("class", "artist-bar-svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
        .append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    const xAxisGroup = svg.append("g")
        .attr("class", "axis x-axis")
        .attr("transform", `translate(0, ${height})`);

    const barsGroup = svg.append("g").attr("class", "bars-group");

    artistBarData = { svg, xAxisGroup, barsGroup, width, height, margin };
    updateArtistBarChart();
}

function updateArtistBarChart() {
    if (!artistBarData.svg || dataset.length === 0) return;

    // Recompute exact required bounds whenever config triggers
    const margin = artistBarData.margin;
    // Map max bounded size to 320px minimum, expanding downward by 28px per artist if N > 10
    const dynamicHeight = Math.max(320 - margin.top - margin.bottom, topNArtistsCount * 28);

    artistBarData.height = dynamicHeight;
    d3.select("#artistBarChartContainer").style("height", (dynamicHeight + margin.top + margin.bottom) + "px");

    // Animate the container SVG viewBox coordinates to seamlessly expand into the newly generated CSS space
    artistBarData.svg.transition().duration(globalAnimationDuration || 500)
        .attr("viewBox", `0 0 ${artistBarData.width + margin.left + margin.right} ${dynamicHeight + margin.top + margin.bottom}`);

    const { svg, xAxisGroup, barsGroup, width, height } = artistBarData;

    // Group by Artist, summing streams and counting songs
    const artistRollup = d3.rollup(dataset, v => ({
        streams: d3.sum(v, d => d.Streams),
        songs: v.length
    }), d => d.Artist);

    // Convert to array and sort
    let topArtists = Array.from(artistRollup, ([artist, data]) => ({
        artist,
        streams: data.streams || 0,
        songs: data.songs
    }))
        .sort((a, b) => d3.descending(a.streams, b.streams))
        .slice(0, topNArtistsCount);

    // Create scales
    // Y maps the rank (0 to length-1) to vertical position
    const y = d3.scaleBand()
        .domain(d3.range(topArtists.length))
        .range([0, height])
        .padding(0.15);

    const x = d3.scaleLinear()
        .domain([0, d3.max(topArtists, d => d.streams) || 1])
        .range([0, width]);

    // Update X Axis position and scale
    xAxisGroup.transition().duration(globalAnimationDuration || 500)
        .attr("transform", `translate(0, ${height})`)
        .call(d3.axisBottom(x).ticks(3).tickFormat(d3.format(".2s")));

    // Data Join connecting via the Artist's name (vital for object constancy in animations)
    const bars = barsGroup.selectAll(".bar-node")
        .data(topArtists, d => d.artist);

    // EXIT
    bars.exit()
        .transition().duration(globalAnimationDuration || 500).ease(d3.easeLinear)
        .attr("transform", `translate(0, ${height + 20})`)
        .style("opacity", 0)
        .remove();

    // ENTER
    const enterBars = bars.enter().append("g")
        .attr("class", d => `bar-node bar-node-${safeId(d.artist)}`)
        .attr("transform", `translate(0, ${height + 20})`)
        .style("opacity", 0);

    enterBars.append("rect")
        .attr("class", "artist-rect")
        .attr("height", y.bandwidth())
        .attr("rx", 3)
        .style("fill", d => colorScale(d.artist))
        .style("cursor", "pointer")
        .on("click", function (event, d) {
            // Find the corresponding bubble node and physically trigger its click event natively
            const bubbleNode = d3.select(".bubble-node-" + safeId(d.artist)).node();
            if (bubbleNode && bubbleNode.parentNode) {
                const parentGroup = d3.select(bubbleNode.parentNode);
                if (parentGroup.on("click")) {
                    parentGroup.dispatch("click");
                }
            } else if (window.triggerBubbleArtistView) {
                // If the bubbles are already completely drilled down, manually trigger the render jump
                window.triggerBubbleArtistView(d.artist);
            }
        })
        .on("mouseover", function (event, d) {
            d3.select(this).style("filter", "brightness(1.5)");
            d3.selectAll(".bubble-node-" + safeId(d.artist)).style("opacity", 1).attr("stroke-width", 3).style("filter", "brightness(1.2)");
        })
        .on("mousemove", function (event, d) {
            const tooltip = d3.select("#tooltip");
            tooltip.transition().duration(200).style("opacity", 1);
            tooltip.html(`
                <div class="tooltip-title">${d.artist}</div>
                <div>Total Streams: <strong>${d3.format(",")(d.streams)}</strong></div>
                <div>Top Tracks: <strong>${d.songs}</strong></div>
            `)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function (event, d) {
            d3.select(this).style("filter", "none");
            d3.selectAll(".bubble-node-" + safeId(d.artist)).style("opacity", 0.75).attr("stroke-width", 1).style("filter", "none");
            d3.select("#tooltip").transition().duration(500).style("opacity", 0);
        });

    // Artist name floating left of the bar
    enterBars.append("text")
        .attr("class", "artist-label")
        .attr("x", -5)
        .attr("y", y.bandwidth() / 2)
        .attr("dy", "0.3em")
        .style("text-anchor", "end")
        .style("fill", "var(--text-primary)")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .text(d => d.artist.length > 14 ? d.artist.substring(0, 12) + ".." : d.artist);

    // Songs / Streams label inside the bar
    enterBars.append("text")
        .attr("class", "stat-label")
        .attr("x", 5)
        .attr("y", y.bandwidth() / 2)
        .attr("dy", "0.3em")
        .style("fill", "#fff")
        .style("font-size", "10px")
        .style("font-weight", "bold")
        .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)")
        .text(d => d.songs + " Tracks");

    // MERGE (Update active/surviving bars mapping to new rank)
    const mergeBars = enterBars.merge(bars);

    // Transition Group to correctly ranked Y position
    mergeBars.transition()
        .duration(globalAnimationDuration || 500)
        .ease(d3.easeLinear)
        .style("opacity", 1)
        .attr("transform", (d, i) => `translate(0, ${y(i)})`);

    // Transition rect width
    mergeBars.select(".artist-rect").transition()
        .duration(globalAnimationDuration || 500)
        .ease(d3.easeLinear)
        .attr("width", d => Math.max(0, x(d.streams)));

    // Update texts inside (optional, in case tracks change dynamically)
    mergeBars.select(".stat-label")
        .text(d => d.songs + " Tracks");
}

/* ---------------------------------------------------------
   TREND LINES (Grid Configuration)
--------------------------------------------------------- */
/* ---------------------------------------------------------
   UNIFIED TREND LINE CHART (Normalized 0-1)
--------------------------------------------------------- */
let unifiedTrendData = {}; // store elements
function initTrendLines() {
    const container = d3.select("#unifiedTrendChart");
    if (container.empty()) return;
    container.html("");

    // Add a legend container inside or above
    const legendDiv = container.append("div")
        .attr("class", "unified-legend")
        .style("display", "flex")
        .style("gap", "15px")
        .style("justify-content", "center")
        .style("padding", "10px")
        .style("flex-wrap", "wrap");

    const margin = { top: 20, right: 30, bottom: 30, left: 50 };
    const width = document.getElementById("unifiedTrendChart").clientWidth - margin.left - margin.right;
    const height = 550 - margin.top - margin.bottom - 40; // minus legend height

    const svg = container.append("svg")
        .attr("width", "100%")
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    const x = d3.scalePoint().domain(d3.range(minYear, maxYear + 1)).range([0, width]);
    const y = d3.scaleLinear().domain([0, 1]).range([height, 0]); // Normalized 0-1

    svg.append("g").attr("class", "axis x-axis").attr("transform", `translate(0, ${height})`)
        .call(d3.axisBottom(x));
    svg.append("g").attr("class", "axis y-axis").call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));

    // Y-axis label
    svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -40)
        .attr("x", -(height / 2))
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .style("fill", "var(--text-secondary)")
        .style("font-size", "12px")
        .text("Relative Normalized Value");

    // Hand-curated palette — 15 perceptually distinct colors, one per feature
    const distinctColors = [
        '#38bdf8', // sky blue      — danceability
        '#f97316', // orange        — energy
        '#a78bfa', // violet        — loudness
        '#34d399', // emerald       — speechiness
        '#f43f5e', // rose          — acousticness
        '#facc15', // amber         — instrumentalness
        '#22d3ee', // cyan          — liveness
        '#c084fc', // purple        — valence
        '#fb923c', // light orange  — tempo
        '#4ade80', // green         — time signature
        '#e879f9', // fuchsia       — mode
        '#60a5fa', // blue          — key
        '#ff6b6b', // coral         — Flesch Kincaid Grade
        '#6ee7b7', // mint          — Lexical Diversity
        '#fbbf24', // gold          — Avg Word Length
    ];
    const featureColor = d3.scaleOrdinal().domain(allFeatures).range(distinctColors);

    const lineMap = {};
    const markerMap = {};

    activeFeatures.forEach(feature => {
        // Draw Legend
        const legItem = legendDiv.append("div").style("display", "flex").style("align-items", "center").style("gap", "5px");
        legItem.append("div").style("width", "12px").style("height", "12px").style("background", featureColor(feature)).style("border-radius", "50%");
        legItem.append("span").style("font-size", "12px").style("color", "var(--text-primary)").text(featureLabel(feature));

        const lineData = yearlyAverages.map(d => ({
            Year: d.Year,
            value: normalize(d[feature], featureStats[feature].min, featureStats[feature].max)
        }));

        const line = d3.line().x(d => x(d.Year)).y(d => y(d.value)).curve(d3.curveMonotoneX);

        const path = svg.append("path")
            .datum(lineData)
            .attr("fill", "none")
            .attr("stroke", featureColor(feature))
            .attr("stroke-width", 2.5)
            .attr("d", line);

        const marker = svg.append("circle")
            .attr("class", "trend-marker")
            .attr("r", 5)
            .style("fill", featureColor(feature))
            .style("stroke", "#fff")
            .style("stroke-width", 2);

        lineMap[feature] = path;
        markerMap[feature] = marker;
    });

    // Scrubber dots (transparent until hover)
    const scrubberDots = {};
    activeFeatures.forEach(f => {
        scrubberDots[f] = svg.append("circle")
            .attr("class", "scrubber-dot")
            .attr("r", 5)
            .style("fill", "#1e293b")
            .style("stroke", featureColor(f))
            .style("stroke-width", 2.5)
            .style("opacity", 0)
            .style("pointer-events", "none");
    });

    const overlay = svg.append("rect")
        .attr("class", "trend-overlay")
        .attr("width", width)
        .attr("height", height)
        .style("fill", "none")
        .style("pointer-events", "all");

    overlay.on("mousemove", function (event) {
        const [mx] = d3.pointer(event);
        const domain = x.domain();
        const step = x.step();

        let index = Math.round(mx / step);
        index = Math.max(0, Math.min(domain.length - 1, index));
        const closestYear = domain[index];

        let htmlContent = `<div class="tooltip-title">Year: ${closestYear}</div>`;
        activeFeatures.forEach(f => {
            const yrData = yearlyAverages.find(d => d.Year === closestYear);
            if (yrData) {
                let valStr = d3.format('.2f')(normalize(yrData[f], featureStats[f].min, featureStats[f].max));
                htmlContent += `<div style="color: ${featureColor(featureColor.domain().includes(f) ? f : 'other')}; font-size: 11px;">${featureLabel(f)}: <strong>${valStr}</strong></div>`;

                // Position corresponding scrubber dot natively on the active graph path
                const normVal = normalize(yrData[f], featureStats[f].min, featureStats[f].max);
                scrubberDots[f]
                    .attr("cx", x(closestYear))
                    .attr("cy", y(normVal))
                    .style("opacity", 1);
            } else {
                scrubberDots[f].style("opacity", 0);
            }
        });

        const tooltip = d3.select("#tooltip");
        tooltip.html(htmlContent)
            .style("left", (event.pageX + 15) + "px")
            .style("top", (event.pageY - 28) + "px")
            .transition().duration(50).style("opacity", 1);

    });

    // --- Milestone Annotations Layer ---
    const annotationsLayer = svg.append("g").attr("class", "annotations-layer").style("opacity", showIndustryEvents ? 1 : 0);
    industryEvents.forEach((evt, i) => {
        if (evt.year < minYear || evt.year > maxYear) return;

        const ex = x(evt.year);
        const g = annotationsLayer.append("g").attr("class", "milestone-group").style("cursor", "help");

        // Vertical dashed guide
        g.append("line")
            .attr("x1", ex).attr("x2", ex)
            .attr("y1", 0).attr("y2", height)
            .attr("stroke", "rgba(255, 255, 255, 0.25)")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "4,4");

        // Horizontal Label (Top Alignment)
        // Offset Y slightly for alternating labels to avoid overlap if years are close
        const yOffset = (i % 2 === 0) ? 15 : 35;

        const labelText = g.append("text")
            .attr("x", ex)
            .attr("y", yOffset)
            .attr("text-anchor", "middle")
            .style("fill", "var(--accent)")
            .style("font-size", "10px")
            .style("font-weight", "800")
            .style("letter-spacing", "0.5px")
            .style("text-transform", "uppercase")
            .style("opacity", 0.6)
            .style("pointer-events", "all")
            .text(evt.label);

        g.on("mouseover", function (event) {
            const tooltip = d3.select("#tooltip");
            tooltip.transition().duration(200).style("opacity", 1);
            tooltip.html(`
                <div class="tooltip-title" style="color:var(--accent); font-size:14px;">${evt.label}</div>
                <div style="font-size: 0.95rem; margin-top:5px; line-height:1.4; color: #fff;">${evt.description}</div>
            `)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");

            labelText.style("opacity", 1).style("filter", "drop-shadow(0 0 5px var(--accent))");
            d3.select(this).select("line").attr("stroke", "var(--accent)").attr("stroke-width", 2);
        })
            .on("mouseout", function () {
                d3.select("#tooltip").transition().duration(500).style("opacity", 0);
                labelText.style("opacity", 0.6).style("filter", "none");
                d3.select(this).select("line").attr("stroke", "rgba(255, 255, 255, 0.25)").attr("stroke-width", 1);
            });
    });

    overlay.on("mouseout", function () {
        Object.values(scrubberDots).forEach(dot => dot.style("opacity", 0));
        d3.select("#tooltip").transition().duration(200).style("opacity", 0);
    });

    unifiedTrendData = { svg, x, y, markerMap, featureColor };
    updateTrendLines();
}

function toggleIndustryEvents() {
    showIndustryEvents = !showIndustryEvents;

    // Synchronize the checkbox states across both toggles
    d3.select("#milestoneToggleInput").property("checked", showIndustryEvents);
    d3.select("#lyricEventToggleInput").property("checked", showIndustryEvents);

    d3.selectAll(".annotations-layer")
        .transition().duration(400)
        .style("opacity", showIndustryEvents ? 1 : 0)
        .style("pointer-events", showIndustryEvents ? "all" : "none");
}

function updateTrendLines() {
    const yr = parseInt(d3.select("#yearSlider").property("value"));
    if (isNaN(yr) || !unifiedTrendData.markerMap) return;

    activeFeatures.forEach(feature => {
        const marker = unifiedTrendData.markerMap[feature];
        if (!marker) return;

        const yrData = yearlyAverages.find(d => d.Year === yr);
        if (yrData) {
            const normVal = normalize(yrData[feature], featureStats[feature].min, featureStats[feature].max);
            marker
                .style("opacity", 1)
                .transition().duration(globalAnimationDuration)
                .attr("cx", unifiedTrendData.x(yr))
                .attr("cy", unifiedTrendData.y(normVal));
        } else {
            marker.style("opacity", 0);
        }
    });
}

function computeYearlyTrends() {
    const yearsToCompute = d3.range(minYear, maxYear + 1);
    yearlyAverages = yearsToCompute.map(yr => {
        const dset = originalDataset.filter(d => d.Year === yr);
        let row = { Year: yr };
        allFeatures.forEach(f => {
            row[f] = dset.length > 0 ? d3.mean(dset, d => d[f]) : 0;
        });
        return row;
    });
}

/* ---------------------------------------------------------
   RIDGELINE PLOT (Density Distribution) - Ordered By Year
--------------------------------------------------------- */
let ridgelineData = {};

function kernelDensityEstimator(kernel, X) {
    return function (V) {
        return X.map(function (x) {
            return [x, d3.mean(V, function (v) { return kernel(x - v); })];
        });
    };
}

function kernelEpanechnikov(k) {
    return function (v) {
        return Math.abs(v /= k) <= 1 ? 0.75 * (1 - v * v) / k : 0;
    };
}

function initRidgeline() {
    const container = d3.select("#ridgelineChart");
    if (container.empty()) return;
    container.html("");

    if (activeFeatures.length === 0) return;

    // Create years array: "All Time" + 2010 to 2024, descending so newest is at the top
    const yearsArr = ["All Time", ...d3.range(minYear, maxYear + 1).reverse()];

    const margin = { top: 60, right: 30, bottom: 50, left: 100 };
    const width = document.getElementById("ridgelineChart").clientWidth - margin.left - margin.right;
    const height = 800 - margin.top - margin.bottom;

    const svg = container.append("svg")
        .attr("width", "100%")
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    const x = d3.scaleLinear().domain([0, 1]).range([0, width]);
    svg.append("g").attr("class", "axis x-axis").attr("transform", `translate(0, ${height})`)
        .call(d3.axisBottom(x).tickFormat(d3.format(".0%")));

    svg.append("text")
        .attr("x", width / 2)
        .attr("y", height + 40)
        .style("text-anchor", "middle")
        .style("fill", "var(--text-secondary)")
        .style("font-size", "13px")
        .text("Relative Feature Intensity");

    const yName = d3.scaleBand().domain(yearsArr).range([0, height]).paddingInner(1);
    svg.append("g").attr("class", "axis y-axis").call(d3.axisLeft(yName).tickSize(0))
        .selectAll(".tick text").style("font-size", "14px").style("fill", "var(--text-primary)").style("font-weight", "bold");

    svg.select(".y-axis .domain").remove();

    const featureColor = d3.scaleOrdinal(d3.schemeCategory10).domain(allFeatures);
    const kde = kernelDensityEstimator(kernelEpanechnikov(0.04), x.ticks(60));

    ridgelineData = { svg, x, yName, kde, featureColor, yearsArr, width, height };

    // Add legend
    const legendDiv = container.append("div")
        .attr("class", "ridgeline-legend")
        .style("position", "absolute")
        .style("top", "15px")
        .style("left", "50%")
        .style("transform", "translateX(-50%)")
        .style("display", "flex")
        .style("gap", "15px")
        .style("background", "rgba(0,0,0,0.5)")
        .style("padding", "8px 16px")
        .style("border-radius", "20px")
        .style("border", "1px solid rgba(255,255,255,0.1)");

    activeFeatures.forEach(feature => {
        const legItem = legendDiv.append("div").style("display", "flex").style("align-items", "center").style("gap", "5px");
        legItem.append("div").style("width", "12px").style("height", "12px").style("background", featureColor(feature)).style("border-radius", "50%");
        legItem.append("span").style("font-size", "12px").style("color", "#fff").text(featureLabel(feature));
    });

    updateRidgeline();
}

function updateRidgeline() {
    if (activeFeatures.length === 0 || !ridgelineData.svg) return;

    const { svg, x, yName, kde, featureColor, yearsArr, height } = ridgelineData;

    let densityData = [];

    yearsArr.forEach(yr => {
        let fSet = (yr === "All Time") ? originalDataset : originalDataset.filter(d => d.Year === yr);
        if (fSet.length === 0) return;

        activeFeatures.forEach(f => {
            let vals = fSet.map(d => normalize(d[f], featureStats[f].min, featureStats[f].max));
            let density = kde(vals);
            densityData.push({
                id: yr + "-" + f,
                year: yr,
                feature: f,
                density: density
            });
        });
    });

    let maxDens = d3.max(densityData, d => d3.max(d.density, p => p[1])) || 1;
    // No overlap: graph height is strictly limited to row height
    const yDensity = d3.scaleLinear().domain([0, maxDens]).range([(height / yearsArr.length) * 0.95, 0]);

    // Draw baselines for each year
    const baselines = svg.selectAll(".ridgeline-baseline").data(yearsArr);
    baselines.enter().append("line")
        .attr("class", "ridgeline-baseline")
        .merge(baselines)
        .attr("x1", 0)
        .attr("x2", ridgelineData.width)
        .attr("y1", d => yName(d))
        .attr("y2", d => yName(d))
        .style("stroke", "rgba(255,255,255,0.1)")
        .style("stroke-width", 1);
    baselines.exit().remove();

    const areas = svg.selectAll(".ridgeline-area").data(densityData, d => d.id);

    areas.enter()
        .append("path")
        .attr("class", "ridgeline-area")
        .merge(areas)
        .transition().duration(globalAnimationDuration)
        .attr("transform", d => `translate(0, ${(yName(d.year) - (height / yearsArr.length) * 0.95)})`)
        .style("fill", d => featureColor(d.feature))
        .style("opacity", 0.85)
        .style("stroke", d => featureColor(d.feature))
        .style("stroke-width", 1.5)
        .style("mix-blend-mode", "normal")
        .attr("d", d => d3.line()
            .curve(d3.curveBasis)
            .x(function (p) { return x(p[0]); })
            .y(function (p) { return yDensity(p[1]); })
            (d.density)
        );

    areas.exit()
        .transition().duration(globalAnimationDuration)
        .style("opacity", 0)
        .remove();

    // Highlight the selected year on the Y-axis
    const selectedYr = d3.select("#yearSlider").property("value");
    const isAllTime = d3.select("#yearLabel").text() === "All Time";
    const highlightTarget = isAllTime ? "All Time" : parseInt(selectedYr);

    svg.selectAll(".y-axis .tick text")
        .transition().duration(300)
        .style("fill", d => d === highlightTarget ? "var(--accent)" : "var(--text-primary)")
        .style("font-size", d => d === highlightTarget ? "16px" : "14px")
        .style("font-weight", d => d === highlightTarget ? "900" : "bold");

    svg.selectAll(".ridgeline-baseline")
        .transition().duration(300)
        .style("stroke", d => d === highlightTarget ? "var(--accent)" : "rgba(255,255,255,0.1)")
        .style("stroke-width", d => d === highlightTarget ? 2 : 1);
}

/* ---------------------------------------------------------
   STUDIO MIXER (Equalizer)
--------------------------------------------------------- */
const mixerDefinitions = [
    { key: "acousticness", color: "#10b981", bottom: "Heavy Synth", top: "Unplugged\n/ Raw" },
    { key: "danceability", color: "#3b82f6", bottom: "Atmospheric", top: "Club Groove" },
    { key: "energy", color: "#f59e0b", bottom: "Chill", top: "High Octane" },
    { key: "valence", color: "var(--accent)", bottom: "Melancholic\n/ Dark", top: "Euphoric\n/ Bright" }
];

let mixerThumbs = {};

function initMixer() {
    const container = d3.select("#mixerContainer");
    if (container.empty()) return;
    container.html("");

    mixerDefinitions.forEach(f => {
        const trackDiv = container.append("div")
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("align-items", "center")
            .style("width", "25%")
            .style("gap", "8px");

        trackDiv.append("div")
            .style("font-size", "10px")
            .style("color", "rgba(255,255,255,0.7)")
            .style("text-transform", "uppercase")
            .style("font-weight", "bold")
            .style("text-align", "center")
            .style("height", "30px")
            .style("flex-shrink", "0")
            .style("pointer-events", "none")
            .html(f.top.replace('\n', '<br>'));

        const trackBg = trackDiv.append("div")
            .style("position", "relative")
            .style("height", "180px")
            .style("width", "6px")
            .style("background", "rgba(0,0,0,0.5)")
            .style("flex-shrink", "0")
            .style("border-radius", "3px")
            .style("border", "1px solid rgba(255,255,255,0.1)")
            .style("box-shadow", "inset 0 1px 4px rgba(0,0,0,0.8)");

        // Background tick marks for the mixer
        for (let i = 0; i <= 4; i++) {
            trackBg.append("div")
                .style("position", "absolute")
                .style("left", "-6px")
                .style("width", "18px")
                .style("height", "1px")
                .style("background", "rgba(255,255,255,0.15)")
                .style("bottom", (i * 25) + "%");
        }

        // Fader Range Labels
        trackBg.append("div")
            .style("position", "absolute")
            .style("right", "-22px")
            .style("top", "-4px")
            .style("font-size", "9px")
            .style("font-weight", "bold")
            .style("color", "rgba(255,255,255,0.4)")
            .style("pointer-events", "none")
            .text(featureStats[f.key].max >= 100 ? d3.format(".0f")(featureStats[f.key].max) : d3.format(".1f")(featureStats[f.key].max));

        trackBg.append("div")
            .style("position", "absolute")
            .style("right", "-22px")
            .style("bottom", "-4px")
            .style("font-size", "9px")
            .style("font-weight", "bold")
            .style("color", "rgba(255,255,255,0.4)")
            .style("pointer-events", "none")
            .text(d3.format(".1f")(featureStats[f.key].min));

        // The thumb
        const thumb = trackBg.append("div")
            .style("position", "absolute")
            .style("bottom", "0px")
            .style("left", "-9px")
            .style("width", "24px")
            .style("height", "16px")
            .style("background", "#2a2a2a")
            .style("border", "1px solid #444")
            .style("border-bottom", `3px solid ${f.color}`)
            .style("border-radius", "4px")
            .style("box-shadow", `0 4px 6px rgba(0,0,0,0.8), 0 0 10px ${f.color}66`)
            .style("pointer-events", "all")
            .style("cursor", "ns-resize");

        // Fader grip lines
        thumb.append("div").style("position", "absolute").style("top", "4px").style("left", "4px").style("right", "4px").style("height", "1px").style("background", "rgba(255,255,255,0.2)").style("pointer-events", "none");
        thumb.append("div").style("position", "absolute").style("top", "7px").style("left", "4px").style("right", "4px").style("height", "1px").style("background", "rgba(255,255,255,0.2)").style("pointer-events", "none");

        const drag = d3.drag()
            .on("start", function (event) {
                isDraggingThumb[f.key] = true;
                d3.select(this).style("box-shadow", `0 0 20px ${f.color}`);
                d3.select(this).style("border", `1px solid ${f.color}`);
            })
            .on("drag", function (event) {
                let currentBottom = parseFloat(d3.select(this).style("bottom")) || 0;
                let newBottom = currentBottom - event.dy;
                newBottom = Math.max(0, Math.min(180 - 16, newBottom));

                d3.select(this).style("bottom", newBottom + "px");

                let norm = newBottom / (180 - 16);
                let rawVal = norm * (featureStats[f.key].max - featureStats[f.key].min) + featureStats[f.key].min;

                mixerFilters[f.key] = rawVal;

                // Realtime filtering! 
                applyFilters();
            })
            .on("end", function (event) {
                isDraggingThumb[f.key] = false;
                d3.select(this).style("box-shadow", `0 4px 6px rgba(0,0,0,0.8), 0 0 10px ${f.color}66`);
                d3.select(this).style("border", "1px solid #444");
            });

        thumb.call(drag);

        mixerThumbs[f.key] = thumb;

        trackDiv.append("div")
            .style("font-size", "10px")
            .style("color", "rgba(255,255,255,0.5)")
            .style("text-transform", "uppercase")
            .style("font-weight", "bold")
            .style("text-align", "center")
            .style("height", "24px")
            .style("pointer-events", "none")
            .style("margin-top", "4px")
            .html(f.bottom.replace('\n', '<br>'));

        let nameDiv = trackDiv.append("div")
            .style("font-size", "12px")
            .style("color", f.color)
            .style("margin-top", "5px")
            .style("text-transform", "capitalize")
            .style("font-weight", "bold")
            .style("letter-spacing", "1px")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", "4px");

        nameDiv.append("span").text(f.key);

        // Add a reset button (rounded arrow)
        nameDiv.append("span").html("&#8634;") // ↺
            .style("cursor", "pointer")
            .style("color", "rgba(255,255,255,0.8)")
            .style("background", "rgba(255,255,255,0.1)")
            .style("border-radius", "50%")
            .style("width", "16px")
            .style("height", "16px")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("font-size", "11px")
            .style("opacity", "0.4")
            .style("transition", "all 0.2s ease")
            .on("mouseover", function () { d3.select(this).style("opacity", 1).style("background", "rgba(255,255,255,0.3)"); })
            .on("mouseout", function () { d3.select(this).style("opacity", 0.4).style("background", "rgba(255,255,255,0.1)"); })
            .on("click", function () {
                mixerFilters[f.key] = null;
                applyFilters();
            });
    });

    // Global reset button logic
    d3.select("#resetMixerBtn").on("click", function () {
        for (let key in mixerFilters) {
            mixerFilters[key] = null;
        }
        applyFilters();
    });

    updateMixer();
}

function updateMixer() {
    mixerDefinitions.forEach(f => {
        let val;
        // If user is actively filtering, use the filter value so thumb doesn't reset
        if (mixerFilters[f.key] !== null) {
            val = mixerFilters[f.key];
        } else {
            val = selectedTrack ? selectedTrack[f.key] : globalAverages[f.key];
            if (val === undefined || isNaN(val)) {
                val = globalAverages[f.key] || 0;
            }
        }

        let norm = normalize(val, featureStats[f.key].min, featureStats[f.key].max);

        // Math to position bottom correctly. The track is 180px, thumb is 16px.
        const px = Math.max(0, Math.min(180 - 16, norm * (180 - 16)));

        if (mixerThumbs[f.key] && !isDraggingThumb[f.key]) {
            mixerThumbs[f.key]
                .transition()
                .ease(d3.easeCubicOut)
                .duration(globalAnimationDuration || 600)
                .style("bottom", px + "px");
        }
    });
}

/* ---------------------------------------------------------
   PARALLEL COORDINATES
--------------------------------------------------------- */
let parallelData = {};

function initParallelChart() {
    const container = d3.select("#parallelChartContainer");
    if (container.empty()) return;
    container.html("");

    // We will plot ALL features, not just active features
    // but users can reorder or we just stick to allFeatures map.
    const margin = { top: 40, right: 40, bottom: 30, left: 40 };
    const width = document.getElementById("parallelChartContainer").clientWidth - margin.left - margin.right;
    const height = 500 - margin.top - margin.bottom;

    const svg = container.append("svg")
        .attr("width", "100%")
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    // X scale is for the features (ordinal)
    const x = d3.scalePoint().domain(audioMetrics).range([0, width]);

    // Create a Y scale for each feature
    const y = {};
    audioMetrics.forEach(f => {
        y[f] = d3.scaleLinear()
            .domain([featureStats[f].min, featureStats[f].max])
            .range([height, 0]);
    });

    // Draw the lines group FIRST so it sits behind the axes
    const linesGroup = svg.append("g").attr("class", "parallel-lines");
    const highlightGroup = svg.append("g").attr("class", "parallel-highlight");

    // Draw the axes
    audioMetrics.forEach(f => {
        const axisGroup = svg.append("g")
            .attr("transform", `translate(${x(f)}, 0)`)
            .attr("class", "parallel-axis");

        axisGroup.call(d3.axisLeft(y[f]).ticks(5).tickSize(-4).tickPadding(8))
            .selectAll("text")
            .style("fill", "var(--text-secondary)")
            .style("font-size", "9px");

        axisGroup.append("text")
            .attr("y", -15)
            .style("text-anchor", "middle")
            .style("fill", "var(--text-primary)")
            .style("font-weight", "bold")
            .style("text-transform", "capitalize")
            .style("cursor", "grab")
            .text(f);

        // Style axis line
        axisGroup.selectAll(".domain")
            .style("stroke", "rgba(255,255,255,0.2)")
            .style("stroke-width", "2px");
    });

    parallelData = { svg, x, y, linesGroup, highlightGroup, width, height };
    updateParallelChart();
}

function updateParallelChart() {
    if (!parallelData.svg || dataset.length === 0) return;
    const { x, y, linesGroup, highlightGroup } = parallelData;

    // Function to calculate exact path
    function path(d) {
        return d3.line()(audioMetrics.map(f => {
            let val = (d[f] !== undefined && !isNaN(d[f])) ? d[f] : 0;
            return [x(f), y[f](val)];
        }));
    }

    // For performance, if the dataset is over 2000 items, we randomly sample to 2000 to prevent WebGL/SVG crashing
    let maxItems = 1500;
    let plotData = dataset;
    if (plotData.length > maxItems) {
        // basic deterministic sampling
        const step = Math.ceil(plotData.length / maxItems);
        plotData = plotData.filter((d, i) => i % step === 0);
    }

    const paths = linesGroup.selectAll("path").data(plotData, d => d.id || d.Title);

    const mergedPaths = paths.enter().append("path")
        .merge(paths)
        .style("cursor", "pointer")
        .on("mouseover", function (event, d) {
            // Un-highlight all global paths
            linesGroup.selectAll("path")
                .style("stroke", p => (selectedTrack && selectedTrack.Title === p.Title) ? "transparent" : "rgba(255, 255, 255, 0.01)")
                .style("stroke-width", "1px");

            // Specifically highlight active hovered path
            d3.select(this)
                .style("stroke", "rgba(255, 255, 255, 1)")
                .style("stroke-width", "4px")
                .raise();

            const tooltip = d3.select("#tooltip");
            tooltip.transition().duration(200).style("opacity", 1);
            tooltip.html(`
                <div class="tooltip-title">${d.Title}</div>
                <div>Artist: ${d.Artist}</div>
                <div>Streams: ${d3.format(",")(d.Streams)}</div>
            `)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function (event, d) {
            // Restore context opacity globally to map
            linesGroup.selectAll("path")
                .style("stroke", p => (selectedTrack && selectedTrack.Title === p.Title) ? "transparent" : (selectedTrack ? "rgba(255, 255, 255, 0.02)" : "rgba(255, 255, 255, 0.05)"))
                .style("stroke-width", "1px");

            d3.select("#tooltip").transition().duration(200).style("opacity", 0);
        })
        .on("click", function (event, d) {
            if (selectedTrack && selectedTrack.Title === d.Title) {
                selectedTrack = null;
            } else {
                selectedTrack = d;
            }
            updateDashboard();
        });

    mergedPaths.transition().duration(globalAnimationDuration)
        .attr("d", path)
        .style("fill", "none")
        .style("stroke", d => (selectedTrack && selectedTrack.Title === d.Title) ? "transparent" : (selectedTrack ? "rgba(255, 255, 255, 0.02)" : "rgba(255, 255, 255, 0.05)"))
        .style("stroke-width", "1px");

    paths.exit().remove();

    // Highlight selected track or nothing
    highlightGroup.selectAll("path").remove();

    if (selectedTrack) {
        // Dim the background lines to make the highlight pop
        linesGroup.selectAll("path").style("stroke", "rgba(255, 255, 255, 0.02)");

        highlightGroup.append("path")
            .datum(selectedTrack)
            .attr("d", path)
            .style("fill", "none")
            .style("stroke", "var(--accent)")
            .style("stroke-width", "4px")
            .style("filter", "drop-shadow(0 0 8px var(--accent))");

        // Draw the labels for the specific values at each axis intersection
        highlightGroup.selectAll("circle").data(allFeatures).enter().append("circle")
            .attr("cx", f => x(f))
            .attr("cy", f => {
                let val = (selectedTrack[f] !== undefined && !isNaN(selectedTrack[f])) ? selectedTrack[f] : 0;
                return y[f](val);
            })
            .attr("r", 5)
            .style("fill", "#fff")
            .style("stroke", "var(--accent)")
            .style("stroke-width", "2px");

        highlightGroup.selectAll(".parallel-val-label").data(allFeatures).enter().append("text")
            .attr("class", "parallel-val-label")
            .attr("x", f => x(f) + 8)
            .attr("y", f => {
                let val = (selectedTrack[f] !== undefined && !isNaN(selectedTrack[f])) ? selectedTrack[f] : 0;
                return y[f](val) + 4;
            })
            .style("fill", "#fff")
            .style("font-size", "11px")
            .style("font-weight", "bold")
            .style("pointer-events", "none")
            .style("text-shadow", "0 1px 3px rgba(0,0,0,0.9)")
            .text(f => {
                let val = (selectedTrack[f] !== undefined && !isNaN(selectedTrack[f])) ? selectedTrack[f] : 0;
                return formatFeatureVal(f, val);
            });
    } else {
        linesGroup.selectAll("path").style("stroke", "rgba(255, 255, 255, 0.05)");
    }
}

/* ---------------------------------------------------------
   RADIAL SCATTER PLOT (THE MUSICAL APPROACH)
--------------------------------------------------------- */
let radialSimulation = null;
let radialSvg = null;

function initRadialChart() {
    const containerNode = document.getElementById("radialChartContainer");
    if (!containerNode) return;

    d3.select(containerNode).select('svg').remove();
    if (radialSimulation) radialSimulation.stop();

    const width = containerNode.clientWidth;
    const height = containerNode.clientHeight || 600;
    const margin = 50;
    const radius = Math.min(width, height) / 2 - margin;

    radialSvg = d3.select(containerNode).append('svg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${width / 2}, ${height / 2})`);

    const keysMap = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

    // Background rings based on Sentiment Score bounds (-1 to 1)
    const rings = [-1, 0, 1];
    const rScale = d3.scaleLinear().domain([-1, 1]).range([0, radius]);

    // Draw rings
    radialSvg.selectAll('.ring')
        .data(rings).enter().append('circle')
        .attr('class', 'ring')
        .attr('r', d => rScale(d))
        .style('fill', 'none')
        .style('stroke', 'rgba(255,255,255,0.05)')
        .style('stroke-dasharray', d => d === 0 ? '4 4' : 'none');

    // Ring Labels
    radialSvg.append('text')
        .attr('x', 5)
        .attr('y', -rScale(-1) - 5)
        .style('fill', 'rgba(255,255,255,0.3)')
        .style('font-size', '10px')
        .text('Sad (-1)');

    radialSvg.append('text')
        .attr('x', 5)
        .attr('y', -rScale(0) - 5)
        .style('fill', 'rgba(255,255,255,0.3)')
        .style('font-size', '10px')
        .text('Neutral (0)');

    radialSvg.append('text')
        .attr('x', 5)
        .attr('y', -rScale(1) - 5)
        .style('fill', 'rgba(255,255,255,0.3)')
        .style('font-size', '10px')
        .text('Euphoric (+1)');

    // Draw Spokes & Key Labels
    keysMap.forEach((k, i) => {
        const angle = (i * Math.PI) / 6 - Math.PI / 2;
        radialSvg.append('line')
            .attr('x1', 0).attr('y1', 0)
            .attr('x2', radius * Math.cos(angle))
            .attr('y2', radius * Math.sin(angle))
            .style('stroke', 'rgba(255,255,255,0.05)');

        // Label
        const labelRadius = radius + 20;
        radialSvg.append('text')
            .attr('x', labelRadius * Math.cos(angle))
            .attr('y', labelRadius * Math.sin(angle))
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .style('fill', 'rgba(255,255,255,0.9)')
            .style('font-size', '15px')
            .style('font-weight', '900')
            .text(k);
    });

    // Mode Legend (Top Left)
    const legendGroup = radialSvg.append('g').attr('transform', `translate(${-width / 2 + 20}, ${-height / 2 + 20})`);

    legendGroup.append('circle').attr('cx', 10).attr('cy', 10).attr('r', 6).style('fill', '#fbbf24');
    legendGroup.append('text').attr('x', 25).attr('y', 14).style('fill', 'rgba(255,255,255,0.8)').style('font-size', '12px').text('Major');

    legendGroup.append('circle').attr('cx', 10).attr('cy', 30).attr('r', 6).style('fill', '#c084fc');
    legendGroup.append('text').attr('x', 25).attr('y', 34).style('fill', 'rgba(255,255,255,0.8)').style('font-size', '12px').text('Minor');

    const plotData = dataset.filter(d => !isNaN(d.key) && !isNaN(d.Sentiment_Score) && !isNaN(d.mode));

    plotData.forEach(d => {
        const angle = (d.key * Math.PI) / 6 - Math.PI / 2;
        const r = rScale(d.Sentiment_Score);
        d.radialX = r * Math.cos(angle);
        d.radialY = r * Math.sin(angle);
        // Start from center to animate outward
        d.x = 0;
        d.y = 0;
    });

    const dots = radialSvg.selectAll('.radial-dot').data(plotData, d => d.id || d.Title);

    dots.enter().append('circle')
        .attr('class', 'radial-dot')
        .attr('r', 4.5)
        .style('fill', d => d.mode === 1 ? '#fbbf24' : '#c084fc') // Bright Yellow for Major, Purple for Minor
        .style('stroke', 'none')
        .style('stroke-width', 0)
        .style('opacity', 0.85)
        .style('cursor', 'pointer')
        .on('mouseover', function (event, d) {
            d3.select(this)
                .style('stroke', '#fff')
                .style('stroke-width', 2.5)
                .attr('r', 6)
                .raise();

            const tTip = d3.select('#tooltip');
            tTip.transition().duration(200).style('opacity', 1);
            tTip.html(`
                <div class="tooltip-title">${d.Title}</div>
                <div>Artist: ${d.Artist}</div>
                <div style="margin-top:5px;border-top:1px solid rgba(255,255,255,0.1);padding-top:5px;">
                    <div>Key: <strong style="color:var(--accent)">${keysMap[d.key]}</strong></div>
                    <div>Mode: <strong style="color:${d.mode === 1 ? '#fbbf24' : '#c084fc'}">${d.mode === 1 ? 'Major' : 'Minor'}</strong></div>
                    <div>Sentiment: <strong style="color:var(--accent)">${d3.format('.2f')(d.Sentiment_Score)}</strong></div>
                </div>
            `)
                .style('left', (event.pageX + 15) + 'px')
                .style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', function (event, d) {
            const isSel = selectedTrack && selectedTrack.Title === d.Title;
            d3.select(this)
                .style('stroke', isSel ? '#fff' : 'none')
                .style('stroke-width', isSel ? 2.5 : 0)
                .attr('r', isSel ? 7 : 4.5)
                .style('opacity', isSel ? 1 : (selectedTrack ? 0.15 : 0.85));
            d3.select('#tooltip').transition().duration(500).style('opacity', 0);
        })
        .on('click', function (event, d) {
            selectedTrack = (selectedTrack && selectedTrack.Title === d.Title) ? null : d;
            updateDashboard();
            event.stopPropagation();
        });

    radialSimulation = d3.forceSimulation(plotData)
        .force('x', d3.forceX(d => d.radialX).strength(0.8))
        .force('y', d3.forceY(d => d.radialY).strength(0.8))
        .force('collide', d3.forceCollide(5.5).iterations(2))
        .alphaDecay(0.04)
        .on('tick', () => {
            radialSvg.selectAll('.radial-dot')
                .attr('cx', d => d.x)
                .attr('cy', d => d.y);
        });

    updateRadialChart();
}

function updateRadialChart() {
    if (!radialSvg) return;
    radialSvg.selectAll('.radial-dot')
        .transition().duration(200)
        .style('stroke', d => (selectedTrack && selectedTrack.Title === d.Title) ? '#fff' : 'none')
        .style('stroke-width', d => (selectedTrack && selectedTrack.Title === d.Title) ? 2.5 : 0)
        .attr('r', d => (selectedTrack && selectedTrack.Title === d.Title) ? 7 : 4.5)
        .style('opacity', d => selectedTrack ? (d.Title === selectedTrack.Title ? 1 : 0.15) : 0.85);
}

/* ---------------------------------------------------------
   TIMELINE WORD CLOUD (LYRICAL DNA)
--------------------------------------------------------- */
let wordCloudSvg = null;
let wordCloudGroup = null;
let selectedWordCategory = null;

function initWordCloud() {
    const containerNode = document.getElementById("wordCloudContainer");
    if (!containerNode) return;

    // Setup SVG
    const width = containerNode.clientWidth;
    const height = containerNode.clientHeight || 300;

    d3.select(containerNode).select('svg').remove();
    wordCloudSvg = d3.select(containerNode).append('svg')
        .attr('width', width)
        .attr('height', height);

    wordCloudGroup = wordCloudSvg.append('g')
        .attr('transform', `translate(${width / 2}, ${height / 2})`);

    updateWordCloud();
}

function updateWordCloud() {
    if (!wordCloudGroup) return;

    // 1. Filter dataset by year (or aggregate if All Time)
    let wordsData = [];
    if (selectedYear) {
        wordsData = wordcloudDataset.filter(d => d.Year === selectedYear);
    } else {
        // Aggregate 'All Time'
        const agg = d3.rollups(wordcloudDataset, v => d3.sum(v, d => d.Frequency), d => d.Word);
        wordsData = agg.map(([Word, Frequency]) => {
            // Re-fetch category for aggregated words
            const firstMatch = wordcloudDataset.find(w => w.Word === Word);
            return { Word, Frequency, Category: firstMatch ? firstMatch.Category : 'other' };
        });
    }

    // 2. ADDITIONAL FILTER: Show only words in selected category from Bar Chart
    if (selectedWordCategory) {
        wordsData = wordsData.filter(d => d.Category === selectedWordCategory);
    }

    // Sort and take top 60 to prevent massive overlaps or slow computation
    wordsData.sort((a, b) => b.Frequency - a.Frequency);
    wordsData = wordsData.slice(0, 60);

    if (wordsData.length === 0) {
        wordCloudGroup.selectAll("*").remove();
        wordCloudGroup.append("text").text("No Lyrics Found").attr("text-anchor", "middle").style("fill", "rgba(255,255,255,0.3)");
        return;
    }

    // Prepare scale for font size
    const minFreq = d3.min(wordsData, d => d.Frequency) || 1;
    const maxFreq = d3.max(wordsData, d => d.Frequency) || 10;
    const fontScale = d3.scaleSqrt().domain([minFreq, maxFreq]).range([12, 55]);

    // Color scale for words
    const colors = ['#10b981', '#34d399', '#6ee7b7', '#fcd34d', '#fbbf24', '#c084fc', '#a855f7', '#fff'];

    // Requires d3.layout.cloud library loaded in HTML
    d3.layout.cloud().size([document.getElementById("wordCloudContainer").clientWidth, (document.getElementById("wordCloudContainer").clientHeight || 300)])
        .words(wordsData.map(d => ({ text: d.Word, size: fontScale(d.Frequency), category: d.Category })))
        .padding(3)
        .rotate(() => (~~(Math.random() * 2) * 90) - 45) // Rotate either -45 or 45 roughly
        .font("Inter")
        .fontSize(d => d.size)
        .on("end", drawCloud)
        .start();

    function drawCloud(words) {
        const textElements = wordCloudGroup.selectAll("text").data(words, d => d.text);

        textElements.exit()
            .transition().duration(400)
            .style('opacity', 0)
            .remove();

        const textEnter = textElements.enter().append("text")
            .style("font-family", "Outfit, sans-serif")
            .style("font-weight", "800")
            .style("fill", d => categoryColors[d.category] || "#fff")
            .attr("text-anchor", "middle")
            .attr("transform", d => `translate(${d.x}, ${d.y}) rotate(${d.rotate})`)
            .style('opacity', 0)
            .text(d => d.text);

        // Transition merge
        textElements.merge(textEnter)
            .transition().duration(600)
            .attr("transform", d => `translate(${d.x}, ${d.y}) rotate(${d.rotate})`)
            .style("font-size", d => `${d.size}px`)
            .style("fill", d => categoryColors[d.category] || "#fff")
            .style('opacity', 0.9);
    }
}

/* ---------------------------------------------------------
   KEY BUBBLE CHART (MUSICAL KEY ANATOMY)
--------------------------------------------------------- */
let keyChartSvg = null;
let keyChartActiveKey = null; // null = level 1 (keys), otherwise = index 0-11
let keyChartActiveMode = null; // null = not selected, 1 = Major, 0 = Minor
let keyChartSimulation = null;

function initKeyChart() {
    const containerNode = document.getElementById("keyChartContainer");
    if (!containerNode) return;

    const width = containerNode.clientWidth;
    const height = containerNode.clientHeight || 250;

    // 1) Persistent SVG & Group handling for smooth morphing
    let svg = d3.select(containerNode).select('svg');
    if (svg.empty()) {
        keyChartSvg = d3.select(containerNode).append('svg')
            .attr('width', width)
            .attr('height', height);
        keyChartSvg.append('g').attr('class', 'key-chart-main-g')
            .attr('transform', `translate(${width / 2}, ${height / 2})`);
    } else {
        keyChartSvg = svg;
    }

    const g = keyChartSvg.select('.key-chart-main-g');
    if (keyChartSimulation) keyChartSimulation.stop();

    const keysMap = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
    const plotData = dataset.filter(d => !isNaN(d.key) && !isNaN(d.Sentiment_Score) && !isNaN(d.mode));

    const backBtn = d3.select("#keyChartBackBtn");
    backBtn.on("click", () => {
        if (keyChartActiveMode !== null) {
            keyChartActiveMode = null;
        } else {
            keyChartActiveKey = null;
            backBtn.style("display", "none");
        }
        initKeyChart();
    });

    if (keyChartActiveKey === null || isNaN(keyChartActiveKey)) {
        // LEVEL 1: RADIAL ROSE CHART (Key selection)
        backBtn.style("display", "none");
        g.selectAll('.key-segment, .key-count-label, .key-label, .radial-guide, .key-song-bubble, .mode-bubble').remove(); 
        keyChartSvg.selectAll(".key-chart-header").remove();

        const rollup = d3.rollup(plotData, v => v.length, d => d.key);
        const keysData = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(k => ({
            key: k,
            count: rollup.get(k) || 0,
            label: keysMap[k]
        }));

        const maxCount = d3.max(keysData, d => d.count) || 1;
        const outerRadius = Math.min(width, height) / 2 - 45;
        const innerRadius = 30;

        const rScale = d3.scaleLinear().domain([0, maxCount]).range([innerRadius, outerRadius]);
        const colorScale = d3.scaleLinear().domain([0, maxCount]).range(['rgba(6, 182, 212, 0.25)', 'rgba(6, 182, 212, 0.85)']);

        const arc = d3.arc()
            .innerRadius(innerRadius)
            .outerRadius(d => rScale(d.count))
            .startAngle((d, i) => (i * 30 * Math.PI) / 180)
            .endAngle((d, i) => ((i + 1) * 30 * Math.PI) / 180)
            .padAngle(0.02)
            .cornerRadius(4);

        const levels = [0.5, 1];
        g.selectAll('.radial-guide').data(levels).join('circle')
            .attr('class', 'radial-guide')
            .attr('r', d => innerRadius + (outerRadius - innerRadius) * d)
            .style('fill', 'none').style('stroke', 'rgba(255,255,255,0.08)').style('stroke-dasharray', '4,4');

        const segments = g.selectAll('.key-segment').data(keysData, d => d.key);
        segments.join(
            enter => enter.append('path')
                .attr('class', 'key-segment')
                .attr('d', arc)
                .style('fill', d => colorScale(d.count))
                .style('stroke', 'rgba(255,255,255,0.1)')
                .style('cursor', 'pointer')
                .style('opacity', 0)
        )
            .on('click', (event, d) => { keyChartActiveKey = d.key; initKeyChart(); })
            .on('mouseover', function (event, d) {
                d3.select(this).style('fill', '#fff').style('stroke', '#fff');
                const tTip = d3.select('#tooltip');
                tTip.transition().duration(200).style('opacity', 1);
                tTip.html(`<div class="tooltip-title">Key: ${d.label}</div><div style="font-size:1.1rem; color:var(--accent); font-weight:bold;">${d.count} Songs</div>`).style('left', (event.pageX + 15) + 'px').style('top', (event.pageY - 28) + 'px');
            })
            .on('mouseout', function (event, d) {
                d3.select(this).style('fill', colorScale(d.count)).style('stroke', 'rgba(255,255,255,0.1)');
                d3.select('#tooltip').transition().duration(500).style('opacity', 0);
            })
            .attr('d', arc)
            .style('fill', d => colorScale(d.count))
            .style('opacity', 1);

        g.selectAll('.key-count-label').data(keysData, d => d.key).join('text')
            .attr('class', 'key-count-label')
            .attr('text-anchor', 'middle').attr('dy', '0.35em')
            .style('fill', '#fff').style('font-size', '9px').style('font-weight', 'bold')
            .style('pointer-events', 'none')
            .text(d => d.count > 0 ? d.count : '')
            .attr('transform', d => {
                const centroid = d3.arc().innerRadius(innerRadius).outerRadius(rScale(d.count)).startAngle(((d.key * 30) * Math.PI) / 180).endAngle((((d.key + 1) * 30) * Math.PI) / 180).centroid();
                return `translate(${centroid[0]}, ${centroid[1]})`;
            })
            .style('opacity', d => d.count > 0 ? 0.85 : 0);

        g.selectAll('.key-label').data(keysData, d => d.key).join('text')
            .attr('class', 'key-label')
            .attr('text-anchor', 'middle').attr('dy', '0.35em')
            .attr('x', (d, i) => (outerRadius + 22) * Math.sin(((i * 30 + 15) * Math.PI) / 180))
            .attr('y', (d, i) => -(outerRadius + 22) * Math.cos(((i * 30 + 15) * Math.PI) / 180))
            .style('fill', 'rgba(255,255,255,0.7)').style('font-size', '11px').style('font-weight', 'bold').style('pointer-events', 'none')
            .text(d => d.label);

    } else if (keyChartActiveMode === null) {
        // LEVEL 2: MODE SELECTION (MAJOR vs MINOR)
        backBtn.style("display", "block");
        g.selectAll('.key-segment, .key-count-label, .key-label, .radial-guide, .key-song-bubble').remove(); 
        keyChartSvg.selectAll(".key-chart-header").remove();

        const songsInKey = plotData.filter(d => d.key === keyChartActiveKey);
        const majorSongs = songsInKey.filter(d => d.mode === 1);
        const minorSongs = songsInKey.filter(d => d.mode === 0);

        const modes = [
            { label: 'Major', mode: 1, count: majorSongs.length, color: '#2dd4bf', x: -width/4 },
            { label: 'Minor', mode: 0, count: minorSongs.length, color: '#fb7185', x: width/4 }
        ];

        const node = g.selectAll('.mode-bubble').data(modes, d => d.label);
        node.join(
            enter => {
                const group = enter.append('g').attr('class', 'mode-bubble')
                    .attr('transform', d => `translate(${d.x}, 0)`)
                    .style('cursor', 'pointer')
                    .on('click', (event, d) => { keyChartActiveMode = d.mode; initKeyChart(); });

                group.append('circle')
                    .attr('r', 0)
                    .style('fill', d => d.color)
                    .style('fill-opacity', 0.2)
                    .style('stroke', d => d.color)
                    .style('stroke-width', 2)
                    .transition().duration(600).ease(d3.easeBackOut)
                    .attr('r', d => Math.max(45, Math.min(width/4, 45 + (d.count / (songsInKey.length || 1)) * 60)));

                group.append('text')
                    .attr('dy', '-0.5em')
                    .attr('text-anchor', 'middle')
                    .style('fill', '#fff').style('font-weight', 'bold').style('font-size', '14px')
                    .text(d => d.label);

                group.append('text')
                    .attr('dy', '1em')
                    .attr('text-anchor', 'middle')
                    .style('fill', 'rgba(255,255,255,0.6)').style('font-size', '11px')
                    .text(d => d.count + ' tracks');
                
                return group;
            }
        );

        keyChartSvg.append("text")
            .attr("class", "key-chart-header")
            .attr("x", width / 2).attr("y", 25)
            .attr("text-anchor", "middle")
            .style("fill", "rgba(255, 255, 255, 0.4)").style("font-size", "12px").style("font-weight", "bold")
            .text(`Select Mode in ${keysMap[keyChartActiveKey]}`);

    } else {
        // LEVEL 3: SONG LEVEL (Filtered by Key and Mode)
        backBtn.style("display", "block");
        g.selectAll('.key-segment, .key-count-label, .key-label, .radial-guide, .mode-bubble').remove(); 
        keyChartSvg.selectAll(".key-chart-header").remove();

        const songsFiltered = plotData.filter(d => d.key === keyChartActiveKey && d.mode === keyChartActiveMode);
        const songCount = songsFiltered.length;

        const opacityScale = d3.scaleLinear().domain([-1, 1]).range([0.55, 0.9]);
        const baseRadius = songCount > 200 ? 3 : (songCount > 100 ? 4.5 : 6);

        songsFiltered.forEach(d => {
            d.r = baseRadius + Math.random() * (baseRadius / 3);
            d.x = (Math.random() - 0.5) * 50;
            d.y = (Math.random() - 0.5) * 50;
        });

        const dots = g.selectAll('.key-song-bubble').data(songsFiltered, d => d.id || d.Title);
        const dotsEnter = dots.enter().append('circle')
            .attr('class', 'key-song-bubble')
            .attr('r', d => d.r)
            .style('fill', d => d.mode === 1 ? '#2dd4bf' : '#fb7185') 
            .style('opacity', d => opacityScale(d.Sentiment_Score))
            .style('stroke', '#fff').style('stroke-opacity', d => opacityScale(d.Sentiment_Score)).style('stroke-width', 0.5)
            .style('cursor', 'pointer')
            .on('mouseover', function (event, d) {
                d3.select(this).raise().style('stroke-opacity', 1.0).style('stroke-width', 2.5).attr('r', d.r + 3);
                const tTip = d3.select('#tooltip');
                tTip.transition().duration(200).style('opacity', 1);
                tTip.html(`
                    <div class="tooltip-title">${d.Title}</div>
                    <div>Artist: ${d.Artist}</div>
                    <div style="margin-top:5px;border-top:1px solid rgba(255,255,255,0.1);padding-top:5px;">
                        <div>Key: <strong style="color:var(--accent)">${keysMap[d.key]}</strong></div>
                        <div>Mode: <strong style="color:${d.mode === 1 ? '#2dd4bf' : '#fb7185'}">${d.mode === 1 ? 'Major' : 'Minor'}</strong></div>
                        <div>Sentiment: <strong>${d3.format('.2f')(d.Sentiment_Score)}</strong></div>
                    </div>
                `).style('left', (event.pageX + 15) + 'px').style('top', (event.pageY - 28) + 'px');
            })
            .on('mouseout', function (event, d) {
                const isSel = selectedTrack && selectedTrack.Title === d.Title;
                d3.select(this).style('stroke-width', isSel ? 3 : 0.5).style('stroke-opacity', isSel ? 1 : opacityScale(d.Sentiment_Score)).attr('r', isSel ? d.r + 3 : d.r);
                d3.select('#tooltip').transition().duration(500).style('opacity', 0);
            })
            .on('click', function (event, d) {
                selectedTrack = (selectedTrack && selectedTrack.Title === d.Title) ? null : d;
                updateDashboard();
                event.stopPropagation();
            });

        keyChartSimulation = d3.forceSimulation(songsFiltered)
            .force('x', d3.forceX(0).strength(0.08))
            .force('y', d3.forceY(0).strength(0.08))
            .force('collide', d3.forceCollide(d => d.r + 1).iterations(3))
            .on('tick', () => {
                dotsEnter.attr('cx', d => {
                    d.x = Math.max(-width / 2 + d.r + 10, Math.min(width / 2 - d.r - 10, d.x));
                    return d.x;
                }).attr('cy', d => {
                    const topLimit = (d.x < -width / 4) ? -height / 2 + 50 : -height / 2 + d.r + 10;
                    d.y = Math.max(topLimit, Math.min(height / 2 - d.r - 10, d.y));
                    return d.y;
                });
            });

        keyChartSvg.append("text")
            .attr("class", "key-chart-header")
            .attr("x", width / 2).attr("y", 25)
            .attr("text-anchor", "middle")
            .style("fill", "rgba(255, 255, 255, 0.4)").style("font-size", "12px").style("font-weight", "bold")
            .text(`${keyChartActiveMode === 1 ? 'Major' : 'Minor'} tracks in ${keysMap[keyChartActiveKey]}`);

        updateKeyChart();
    }
}

function updateKeyChart() {
    if (!keyChartSvg || keyChartActiveKey === null) return;
    const opacityScale = d3.scaleLinear().domain([-1, 1]).range([0.55, 0.9]);
    keyChartSvg.selectAll('.key-song-bubble')
        .style('stroke-width', d => (selectedTrack && selectedTrack.Title === d.Title) ? 3 : 0.5)
        .style('stroke-opacity', d => (selectedTrack && selectedTrack.Title === d.Title) ? 1 : opacityScale(d.Sentiment_Score))
        .attr('r', d => (selectedTrack && selectedTrack.Title === d.Title) ? d.r + 3 : d.r);
}

/* ---------------------------------------------------------
   WORD CATEGORY BAR CHART
--------------------------------------------------------- */
let wordCategoryBarSvg = null;
const categoryColors = {
    'profanity': '#ef4444',     // Red
    'emotion': '#ec4899',       // Pink
    'vocalisation': '#8b5cf6',   // Violet
    'movement': '#10b981',      // Green
    'time': '#f59e0b',          // Amber
    'anatomy': '#3b82f6',       // Blue
    'other': '#6b7280'          // Gray
};

function initWordCategoryBarChart() {
    const container = document.getElementById("wordCategoryBarContainer");
    if (!container) return;
    d3.select(container).selectAll("svg").remove();

    // Click background to reset filter
    container.onclick = (e) => {
        if (e.target.id === 'wordCategoryBarContainer' || e.target.tagName === 'svg') {
            selectedWordCategory = null;
            updateDashboard();
        }
    };

    updateWordCategoryBarChart();
}

function updateWordCategoryBarChart() {
    const container = document.getElementById("wordCategoryBarContainer");
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight || 260;
    const margin = { top: 10, right: 30, bottom: 30, left: 85 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    // 1. Aggregate frequencies by category for selected Year (Excluding 'Other')
    let wordsInPeriod = [];
    if (selectedYear) {
        wordsInPeriod = wordcloudDataset.filter(d => d.Year === selectedYear);
    } else {
        wordsInPeriod = wordcloudDataset;
    }

    const categoryMap = d3.rollup(wordsInPeriod,
        v => d3.sum(v, d => d.Frequency),
        d => d.Category || 'other'
    );

    const data = Array.from(categoryMap, ([category, value]) => ({ category, value }))
        .filter(d => d.value > 0 && d.category !== 'other')
        .sort((a, b) => b.value - a.value);

    // 2. Setup SVG
    let svg = d3.select(container).select("svg");
    if (svg.empty()) {
        svg = d3.select(container).append("svg")
            .attr("width", width)
            .attr("height", height);
        svg.append("g").attr("class", "chart-group").attr("transform", `translate(${margin.left}, ${margin.top})`);
    }
    const g = svg.select(".chart-group");

    // 3. Scales
    const x = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.value) || 10])
        .range([0, chartW]);

    const y = d3.scaleBand()
        .domain(data.map(d => d.category))
        .range([0, chartH])
        .padding(0.3);

    // 4. Axes
    let xAxis = g.select(".x-axis");
    if (xAxis.empty()) xAxis = g.append("g").attr("class", "axis x-axis").attr("transform", `translate(0, ${chartH})`);
    xAxis.transition().duration(400).call(d3.axisBottom(x).ticks(5).tickSize(-chartH).tickFormat(d3.format(".2s")));
    xAxis.selectAll(".tick line").attr("stroke", "rgba(255,255,255,0.05)");

    let yAxis = g.select(".y-axis");
    if (yAxis.empty()) yAxis = g.append("g").attr("class", "axis y-axis");
    yAxis.transition().duration(400).call(d3.axisLeft(y));
    yAxis.selectAll("text").style("text-transform", "capitalize").style("font-size", "10px").style("fill", "rgba(255,255,255,0.7)");

    // 5. Bars (Custom path for flat left / rounded right)
    const bars = g.selectAll(".category-bar").data(data, d => d.category);

    bars.exit().remove();

    const barRadius = 6;
    const getBarPath = (width, height) => {
        if (width <= barRadius) return `M0,0 h${width} v${height} h-${width} Z`;
        return `M0,0 
                h${width - barRadius} 
                a${barRadius},${barRadius} 0 0 1 ${barRadius},${barRadius} 
                v${height - 2 * barRadius} 
                a${barRadius},${barRadius} 0 0 1 -${barRadius},${barRadius} 
                h-${width - barRadius} 
                z`;
    };

    bars.enter().append("path")
        .attr("class", "category-bar")
        .attr("transform", d => `translate(0, ${y(d.category)})`)
        .attr("fill", d => categoryColors[d.category] || categoryColors.other)
        .style("cursor", "pointer")
        .on("click", function (event, d) {
            selectedWordCategory = (selectedWordCategory === d.category) ? null : d.category;
            updateDashboard();
            event.stopPropagation();
        })
        .on("mouseover", function (event, d) {
            d3.select(this).style("filter", "brightness(1.4)");
            const total = d3.sum(data, x => x.value);
            const percent = d3.format(".1%")(d.value / total);

            const tooltip = d3.select("#tooltip");
            tooltip.transition().duration(200).style("opacity", 1);
            tooltip.html(`
                <div class="tooltip-title" style="color:${categoryColors[d.category]}; text-transform:capitalize;">${d.category}</div>
                <div style="font-size:1.1rem; font-weight:bold;">${d3.format(",")(d.value)} <span style="font-size:0.7rem; font-weight:normal; opacity:0.6;">(${percent})</span></div>
                <div style="font-size:0.8rem; color:rgba(255,255,255,0.6);">Lyrical occurrences in ${selectedYear || 'All Time'}</div>
            `)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function () {
            d3.select(this).style("filter", "none");
            d3.select("#tooltip").transition().duration(500).style("opacity", 0);
        })
        .merge(bars)
        .transition().duration(600)
        .attr("transform", d => `translate(0, ${y(d.category)})`)
        .attr("d", d => getBarPath(x(d.value), y.bandwidth()))
        .style("opacity", d => (selectedWordCategory === null || selectedWordCategory === d.category) ? 1 : 0.2);

    // 6. Value Labels
    const labels = g.selectAll(".bar-label").data(data, d => d.category);
    labels.exit().remove();
    labels.enter().append("text")
        .attr("class", "bar-label")
        .attr("dy", "0.35em")
        .attr("x", d => x(d.value) + 5)
        .attr("y", d => y(d.category) + y.bandwidth() / 2)
        .style("fill", "rgba(255,255,255,0.5)")
        .style("font-size", "9px")
        .merge(labels)
        .transition().duration(600)
        .attr("x", d => x(d.value) + 5)
        .attr("y", d => y(d.category) + y.bandwidth() / 2)
        .text(d => d3.format(".2s")(d.value));
}

/* ---------------------------------------------------------
   LYRIC EVOLUTION FLOW (Streamgraph / ThemeRiver)
   Shows macroscopic shift of categories over 14 years
--------------------------------------------------------- */
let lyricEvolutionSvg = null;
const snapshotYears = [2010, 2012, 2014, 2016, 2018, 2020, 2022];

function initLyricEvolutionChart() {
    const container = document.getElementById("lyricEvolutionContainer");
    if (!container) return;
    d3.select(container).selectAll("svg").remove();

    updateLyricEvolutionChart();
}

function updateLyricEvolutionChart() {
    const container = document.getElementById("lyricEvolutionContainer");
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight || 450;
    const margin = { top: 60, right: 40, bottom: 40, left: 40 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    // 1. Data Wrangling for Streamgraph
    // Keys: Categories (minus 'other')
    const categories = Object.keys(categoryColors).filter(c => c !== 'other');

    // Group all words by Year then Category
    const yearGroups = d3.groups(wordcloudDataset, d => d.Year).sort((a, b) => a[0] - b[0]);

    const stackData = yearGroups.map(([year, words]) => {
        const row = { year: year };
        categories.forEach(cat => {
            row[cat] = d3.sum(words.filter(w => w.Category === cat), d => d.Frequency);
        });
        return row;
    });

    // 2. Setup SVG
    let svg = d3.select(container).select("svg");
    if (svg.empty()) {
        svg = d3.select(container).append("svg")
            .attr("width", width)
            .attr("height", height);

        // Add a "Time indicator" line for the current selected year
        svg.append("line")
            .attr("class", "year-indicator")
            .attr("y1", margin.top)
            .attr("y2", height - margin.bottom)
            .style("stroke", "var(--accent)")
            .style("stroke-width", "2px")
            .style("stroke-dasharray", "4,4")
            .style("opacity", 0);

        // Add a "Scrub line" (follows mouse)
        svg.append("line")
            .attr("class", "scrub-line")
            .attr("y1", margin.top)
            .attr("y2", height - margin.bottom)
            .style("stroke", "rgba(255, 255, 255, 0.4)")
            .style("stroke-width", "1px")
            .style("opacity", 0);

        svg.append("g").attr("class", "streams-group").attr("transform", `translate(${margin.left}, ${margin.top})`);
        svg.append("g").attr("class", "labels-group").attr("transform", `translate(${margin.left}, ${margin.top})`);
        svg.append("g").attr("class", "lyric-flow-axis").attr("transform", `translate(${margin.left}, ${height - margin.bottom})`);
        svg.append("g").attr("class", "annotations-layer lyric-events-group").attr("transform", `translate(${margin.left}, ${margin.top})`);
    }

    const gStreams = svg.select(".streams-group");
    const gLabels = svg.select(".labels-group");
    const gAxis = svg.select(".lyric-flow-axis");
    const gEvents = svg.select(".lyric-events-group");

    // 3. Stack & Scales
    const stack = d3.stack()
        .keys(categories)
        .offset(d3.stackOffsetWiggle)
        .order(d3.stackOrderNone);

    const series = stack(stackData);

    const x = d3.scaleLinear()
        .domain([d3.min(stackData, d => d.year), d3.max(stackData, d => d.year)])
        .range([0, chartW]);

    const y = d3.scaleLinear()
        .domain([
            d3.min(series, s => d3.min(s, d => d[0])),
            d3.max(series, s => d3.max(s, d => d[1]))
        ])
        .range([chartH, 0]);

    const area = d3.area()
        .x(d => x(d.data.year))
        .y0(d => y(d[0]))
        .y1(d => y(d[1]))
        .curve(d3.curveBasis);

    // 4. Draw Streams
    const streams = gStreams.selectAll(".lyric-stream").data(series, d => d.key);

    streams.exit().remove();

    streams.enter().append("path")
        .attr("class", "lyric-stream")
        .attr("d", area)
        .attr("fill", d => categoryColors[d.key])
        .attr("opacity", 0.7)
        .on("mouseover", function (event, d) {
            gStreams.selectAll(".lyric-stream").classed("dimmed", true);
            d3.select(this).classed("dimmed", false);
            svg.select(".scrub-line").style("opacity", 1);
        })
        .on("mousemove", function (event, d) {
            const [mx] = d3.pointer(event);
            const rawYear = x.invert(mx);
            const year = Math.round(rawYear);

            // Sync the scrub line
            svg.select(".scrub-line")
                .attr("x1", margin.left + x(year))
                .attr("x2", margin.left + x(year));

            // Fetch words from indexed cache
            const yearData = window.lyricLookupIndex ? window.lyricLookupIndex.get(year) : null;
            const topWords = yearData ? (yearData.get(d.key) || []) : [];

            // Generate Mini Cloud Tooltip
            const tooltip = d3.select("#tooltip");
            tooltip.transition().duration(50).style("opacity", 1);

            let miniCloudHtml = `<div class="mini-cloud-container">`;
            if (topWords.length > 0) {
                const maxFreq = topWords[0].Frequency;
                topWords.slice(0, 7).forEach((w, i) => {
                    const size = 0.7 + (w.Frequency / maxFreq) * 0.8; // 0.7rem to 1.5rem
                    const opac = 0.5 + (w.Frequency / maxFreq) * 0.5;
                    miniCloudHtml += `<span class="mini-cloud-word" style="font-size:${size}rem; opacity:${opac}; color:${categoryColors[d.key]}">${w.Word}</span>`;
                });
            } else {
                miniCloudHtml += `<div style="color:var(--text-secondary); opacity:0.5; font-size:0.8rem;">No top keywords for this year.</div>`;
            }
            miniCloudHtml += `</div>`;

            tooltip.html(`
                <div class="tooltip-title" style="color:${categoryColors[d.key]}; text-transform:capitalize;">${d.key} • ${year}</div>
                <div style="font-size:0.7rem; color:rgba(255,255,255,0.4); text-transform:uppercase; margin-bottom:5px;">Top Keywords Preview</div>
                ${miniCloudHtml}
                <div style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:5px; font-size:0.75rem;">
                    Scrubbing through history...
                </div>
            `)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function () {
            gStreams.selectAll(".lyric-stream").classed("dimmed", false);
            svg.select(".scrub-line").style("opacity", 0);
            d3.select("#tooltip").transition().duration(500).style("opacity", 0);
        })
        .merge(streams)
        .transition().duration(800)
        .attr("d", area);

    // 5. Category Labels (Balanced horizontal and vertical centering)
    const labelData = series.map(s => {
        // Find all "thick enough" points (e.g., > 50% of the stream's max thickness)
        // and pick the one closest to the horizontal center of the chart.
        const maxThickness = d3.max(s, d => d[1] - d[0]);
        const midYear = d3.mean(s, d => d.data.year);

        let bestPoint = null;
        let minDistance = Infinity;

        s.forEach(d => {
            const thickness = d[1] - d[0];
            if (thickness >= maxThickness * 0.5) {
                const distToCenter = Math.abs(d.data.year - midYear);
                if (distToCenter < minDistance) {
                    minDistance = distToCenter;
                    bestPoint = { x: d.data.year, y: (d[0] + d[1]) / 2, thickness: thickness };
                }
            }
        });

        return bestPoint ? { key: s.key, ...bestPoint } : null;
    }).filter(d => d !== null && d.thickness > 10);

    const labels = gLabels.selectAll(".lyric-category-label")
        .data(labelData, d => d.key);

    labels.exit().remove();

    labels.enter().append("text")
        .attr("class", "lyric-category-label")
        .attr("x", d => x(d.x))
        .attr("y", d => y(d.y))
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .style("fill", "#fff")
        .style("font-size", "10px")
        .style("font-weight", "900")
        .style("text-transform", "uppercase")
        .style("letter-spacing", "2px")
        .style("pointer-events", "none")
        .style("opacity", 0)
        .text(d => d.key)
        .merge(labels)
        .transition().duration(800)
        .attr("x", d => x(d.x))
        .attr("y", d => y(d.y))
        .style("opacity", 0.6);

    // 6. Axis
    gAxis.transition().duration(400).call(d3.axisBottom(x).ticks(14).tickFormat(d3.format("d")));

    // 7. Highlight Selected Year
    if (selectedYear) {
        svg.select(".year-indicator")
            .transition().duration(globalAnimationDuration)
            .attr("x1", margin.left + x(selectedYear))
            .attr("x2", margin.left + x(selectedYear))
            .style("opacity", 0.8);
    } else {
        svg.select(".year-indicator").style("opacity", 0);
    }

    // 8. Industry Timeline Events (Synchronized with Trend Chart Style)
    gEvents.selectAll("*").remove();
    gEvents.style("opacity", showIndustryEvents ? 1 : 0)
        .style("pointer-events", showIndustryEvents ? "all" : "none");

    if (showIndustryEvents) {
        industryEvents.forEach((evt, i) => {
            if (evt.year < 2010 || evt.year > 2023) return;

            const ex = x(evt.year);
            const mg = gEvents.append("g")
                .attr("class", "industry-event milestone-group")
                .style("cursor", "help");

            // Vertical dashed guide
            const guide = mg.append("line")
                .attr("x1", ex).attr("x2", ex)
                .attr("y1", -40).attr("y2", chartH)
                .style("stroke", "rgba(255, 255, 255, 0.25)")
                .style("stroke-width", "1px")
                .style("stroke-dasharray", "4,4");

            // Alternating Label Position at the TOP
            const yPos = -35 + (i % 2 === 0 ? 0 : 18);

            const mLabel = mg.append("text")
                .attr("x", ex)
                .attr("y", yPos)
                .attr("text-anchor", "middle")
                .style("fill", "var(--accent)")
                .style("font-size", "9px")
                .style("font-weight", "800")
                .style("text-transform", "uppercase")
                .style("letter-spacing", "0.5px")
                .style("opacity", 0.7)
                .text(evt.label);

            // Interaction
            mg.on("mouseover", function (event) {
                const tooltip = d3.select("#tooltip");
                tooltip.transition().duration(200).style("opacity", 1);
                tooltip.html(`
                    <div class="tooltip-title" style="color:var(--accent); font-size:14px;">${evt.label}</div>
                    <div style="font-size: 0.95rem; margin-top:5px; line-height:1.4; color: #fff;">${evt.description}</div>
                `)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");

                mLabel.style("opacity", 1).style("filter", "drop-shadow(0 0 5px var(--accent))");
                guide.style("stroke", "var(--accent)").style("stroke-width", "2px").style("opacity", 1);
            }).on("mouseout", function () {
                d3.select("#tooltip").transition().duration(500).style("opacity", 0);
                mLabel.style("opacity", 0.7).style("filter", "none");
                guide.style("stroke", "rgba(255, 255, 255, 0.25)").style("stroke-width", "1px");
            });
        });
    }
}
