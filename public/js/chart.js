import { el, escapeHtml, monthNames, formatDuration, formatWeekLabel, studiedMinutes, getWeekMonday } from './utils.js';
import { loadSessionsByRange, loadStats } from './api.js';

const DASHBOARD_WEEKS = 8;

// ——— Агрегация ———

export function aggregateByWeek(sessions) {
  const byWeek = {};
  for (const s of sessions) {
    const key = getWeekMonday(s.started_at.slice(0, 10));
    if (!byWeek[key]) byWeek[key] = 0;
    byWeek[key] += studiedMinutes(s);
  }
  return byWeek;
}

function aggregateByMonth(sessions) {
  const byMonth = {};
  for (const s of sessions) {
    const key = s.started_at.slice(0, 7);
    if (!byMonth[key]) byMonth[key] = 0;
    byMonth[key] += studiedMinutes(s);
  }
  return byMonth;
}

function aggregateByWeekDetailed(sessions) {
  const byWeek = {};
  for (const s of sessions) {
    const key = getWeekMonday(s.started_at.slice(0, 10));
    if (!byWeek[key]) byWeek[key] = { minutes: 0, sessionsCount: 0, breaksSum: 0 };
    byWeek[key].minutes += studiedMinutes(s);
    byWeek[key].sessionsCount += 1;
    byWeek[key].breaksSum += Number(s.breaks_minutes) || 0;
  }
  return byWeek;
}

function aggregateByMonthDetailed(sessions) {
  const byMonth = {};
  for (const s of sessions) {
    const key = s.started_at.slice(0, 7);
    if (!byMonth[key]) byMonth[key] = { minutes: 0, sessionsCount: 0, breaksSum: 0 };
    byMonth[key].minutes += studiedMinutes(s);
    byMonth[key].sessionsCount += 1;
    byMonth[key].breaksSum += Number(s.breaks_minutes) || 0;
  }
  return byMonth;
}

// ——— Тема и конфигурация Chart.js ———

const CHART_THEME = {
  grid: 'rgba(255, 255, 255, 0.05)',
  tick: '#9898a8',
  line: '#7c6aef',
  lineLight: 'rgba(124, 106, 239, 0.4)',
  point: '#a496ff',
  pointBorder: '#131318',
  goalLine: 'rgba(251, 191, 36, 0.6)',
  goalLineDash: [5, 5],
  font: "'Plus Jakarta Sans', sans-serif"
};

function createGradientFill(ctx, chartArea) {
  if (!chartArea) return CHART_THEME.lineLight;
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, 'rgba(124, 106, 239, 0.25)');
  gradient.addColorStop(0.6, 'rgba(124, 106, 239, 0.06)');
  gradient.addColorStop(1, 'rgba(124, 106, 239, 0)');
  return gradient;
}

function getChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false }
    },
    scales: {
      x: {
        grid: { color: CHART_THEME.grid, drawBorder: false },
        ticks: {
          color: CHART_THEME.tick,
          maxRotation: 45,
          font: { size: 11, family: CHART_THEME.font }
        }
      },
      y: {
        grid: { color: CHART_THEME.grid, drawBorder: false },
        ticks: {
          color: CHART_THEME.tick,
          font: { size: 11, family: CHART_THEME.font },
          padding: 8
        },
        beginAtZero: true
      }
    }
  };
}

// ——— Datasets ———

function createLineDataset(values) {
  return {
    label: 'Часы',
    data: values,
    borderColor: CHART_THEME.line,
    backgroundColor(context) {
      const chart = context.chart;
      const { ctx, chartArea } = chart;
      if (!chartArea) return CHART_THEME.lineLight;
      return createGradientFill(ctx, chartArea);
    },
    borderWidth: 2.5,
    fill: 'origin',
    tension: 0.35,
    pointRadius: 4,
    pointBackgroundColor: CHART_THEME.point,
    pointBorderColor: CHART_THEME.pointBorder,
    pointBorderWidth: 2,
    pointHoverRadius: 7,
    pointHoverBackgroundColor: '#fff',
    pointHoverBorderColor: CHART_THEME.line,
    pointHoverBorderWidth: 2.5
  };
}

function createThresholdDataset(thresholdHours, labelCount) {
  const t = Number(thresholdHours) || 0;
  return {
    label: 'Цель',
    data: Array(labelCount).fill(t),
    borderColor: CHART_THEME.goalLine,
    borderWidth: 1.5,
    borderDash: CHART_THEME.goalLineDash,
    fill: false,
    pointRadius: 0,
    tension: 0
  };
}

// ——— Кастомный тултип ———

let _tooltipActiveIndex = -1;

function showCustomTooltip(chart, tooltipMeta, event) {
  const tooltipEl = document.getElementById('chartTooltip');
  if (!tooltipEl || !tooltipMeta) return;
  const elements = chart.getElementsAtEventForMode(event, 'index', { intersect: false });
  if (!elements.length) {
    tooltipEl.classList.add('hidden');
    tooltipEl.setAttribute('aria-hidden', 'true');
    _tooltipActiveIndex = -1;
    return;
  }
  const dataIndex = elements[0].index;
  const m = tooltipMeta[dataIndex];
  if (!m) {
    tooltipEl.classList.add('hidden');
    tooltipEl.setAttribute('aria-hidden', 'true');
    _tooltipActiveIndex = -1;
    return;
  }

  const rect = chart.canvas.getBoundingClientRect();
  const point = chart.getDatasetMeta(0).data[dataIndex];
  const x = point ? point.x : rect.width / 2;
  const y = point ? point.y : 0;
  tooltipEl.style.left = `${rect.left + x + 10}px`;
  tooltipEl.style.top = `${rect.top + y + 10}px`;

  if (dataIndex !== _tooltipActiveIndex) {
    _tooltipActiveIndex = dataIndex;
    const dev = m.deviation >= 0 ? `+${m.deviation}` : `${m.deviation}`;
    const devClass = m.deviation >= 0 ? 'chart-tooltip-dev--pos' : 'chart-tooltip-dev--neg';
    const badgeClass = m.belowGoal ? 'chart-tooltip-badge chart-tooltip-badge--below' : 'chart-tooltip-badge chart-tooltip-badge--ok';
    const badgeText = m.belowGoal ? 'Ниже цели' : 'В норме';
    tooltipEl.innerHTML = `
      <div class="chart-tooltip-title">${escapeHtml(m.label)}</div>
      <div class="chart-tooltip-body">
        Часы: ${m.hours} ч<br>
        Цель: ${m.goal} ч<br>
        Отклонение: <span class="${devClass}">${dev} ч</span>
      </div>
      <span class="${badgeClass}">${badgeText}</span>
    `;
  }

  tooltipEl.classList.remove('hidden');
  tooltipEl.setAttribute('aria-hidden', 'false');
}

function bindCustomTooltip(chart, tooltipMeta) {
  const tooltipEl = document.getElementById('chartTooltip');
  if (!tooltipEl) return;
  const canvas = chart.canvas;
  if (canvas._tooltipMove) {
    canvas.removeEventListener('mousemove', canvas._tooltipMove);
    canvas.removeEventListener('mouseleave', canvas._tooltipLeave);
  }
  const onMove = (e) => showCustomTooltip(chart, tooltipMeta, e);
  const onLeave = () => {
    tooltipEl.classList.add('hidden');
    tooltipEl.setAttribute('aria-hidden', 'true');
  };
  canvas._tooltipMove = onMove;
  canvas._tooltipLeave = onLeave;
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
}

// ——— KPI Cards ———

function renderKpiCards(weekKeys, byWeek, byWeekDet, stats) {
  const thresholdHours = parseInt(el('weekThreshold')?.value, 10) || 10;
  const currentWeek = weekKeys[weekKeys.length - 1];
  const prevWeek = weekKeys.length >= 2 ? weekKeys[weekKeys.length - 2] : null;

  const curMin = byWeek[currentWeek] || 0;
  const curHours = toHours(curMin);
  const prevMin = prevWeek ? (byWeek[prevWeek] || 0) : 0;
  const prevHours = toHours(prevMin);

  el('kpiWeekHours').textContent = `${curHours} ч`;
  el('kpiWeekGoal').textContent = `цель: ${thresholdHours} ч`;

  const pct = thresholdHours > 0 ? Math.min((curHours / thresholdHours) * 100, 100) : 0;
  const bar = el('kpiWeekBar');
  bar.style.width = `${pct}%`;
  bar.classList.toggle('over-goal', curHours >= thresholdHours);

  let totalSessions = 0;
  let totalSessionMinutes = 0;
  for (const key of weekKeys) {
    const det = byWeekDet[key];
    if (det) {
      totalSessions += det.sessionsCount;
      totalSessionMinutes += det.minutes;
    }
  }
  const avgMin = totalSessions > 0 ? Math.round(totalSessionMinutes / totalSessions) : 0;
  el('kpiAvgSession').textContent = formatDuration(avgMin);
  el('kpiAvgSub').textContent = `за ${totalSessions} сессий`;

  const totalAll = stats.totalStudiedMinutes || 0;
  const totalH = Math.round((totalAll / 60) * 10) / 10;
  el('kpiTotal').textContent = `${totalH} ч`;
  el('kpiTotalSessions').textContent = `за всё время`;

  const delta = Math.round((curHours - prevHours) * 10) / 10;
  const deltaEl = el('kpiDelta');
  const deltaSubEl = el('kpiDeltaSub');
  if (delta > 0) {
    deltaEl.textContent = `+${delta} ч`;
    deltaEl.className = 'kpi-value kpi-delta--positive';
    deltaSubEl.textContent = 'больше прошлой';
  } else if (delta < 0) {
    deltaEl.textContent = `${delta} ч`;
    deltaEl.className = 'kpi-value kpi-delta--negative';
    deltaSubEl.textContent = 'меньше прошлой';
  } else {
    deltaEl.textContent = '0 ч';
    deltaEl.className = 'kpi-value kpi-delta--neutral';
    deltaSubEl.textContent = 'как прошлая';
  }
}

// ——— Рендер дашборда ———

let chartWeeks = null;
let chartMonths = null;

function destroyChart(chart) {
  if (chart) chart.destroy();
}

const toHours = (min) => Math.round((min / 60) * 10) / 10;

function buildMeta(items, labelFn, detailedMap, threshold) {
  return items.map((key) => {
    const det = detailedMap[key] || { minutes: 0, sessionsCount: 0, breaksSum: 0 };
    const h = toHours(det.minutes);
    return {
      label: labelFn(key),
      hours: h,
      goal: threshold,
      deviation: Math.round((h - threshold) * 10) / 10,
      sessionsCount: det.sessionsCount,
      breaksSum: det.breaksSum,
      belowGoal: h < threshold
    };
  });
}

export async function renderDashboard() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const currentWeekMonday = getWeekMonday(now.toISOString().slice(0, 10));
  const sortedWeeksList = [];
  const d = new Date(currentWeekMonday + 'T12:00:00');
  for (let i = 0; i < DASHBOARD_WEEKS; i++) {
    sortedWeeksList.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 7);
  }
  sortedWeeksList.reverse();

  const weekRangeEnd = new Date(sortedWeeksList[sortedWeeksList.length - 1] + 'T12:00:00');
  weekRangeEnd.setDate(weekRangeEnd.getDate() + 6);
  const weekTo = weekRangeEnd.toISOString().slice(0, 10);

  const fromMonths = new Date(year - 1, month - 1, 1);
  const toMonths = new Date(year, month, 0);

  const [sessionsWeeks, sessionsMonths, stats] = await Promise.all([
    loadSessionsByRange(sortedWeeksList[0], weekTo),
    loadSessionsByRange(fromMonths.toISOString().slice(0, 10), toMonths.toISOString().slice(0, 10)),
    loadStats()
  ]);

  el('dashboardTotalStudied').textContent = formatDuration(stats.totalStudiedMinutes || 0);

  const byWeek = aggregateByWeek(sessionsWeeks);
  const byMonth = aggregateByMonth(sessionsMonths);
  const byWeekDet = aggregateByWeekDetailed(sessionsWeeks);
  const byMonthDet = aggregateByMonthDetailed(sessionsMonths);

  const sortedMonths = Object.keys(byMonth).sort();
  const weekLabels = sortedWeeksList.map(formatWeekLabel);

  el('dashboardWeeksLabel').textContent = `(последние ${DASHBOARD_WEEKS} недель)`;
  el('dashboardMonthsLabel').textContent = '(последние 12 месяцев)';

  renderKpiCards(sortedWeeksList, byWeek, byWeekDet, stats);

  const weeksValues = sortedWeeksList.map((w) => toHours(byWeek[w] || 0));
  const monthsValues = sortedMonths.map((m) => toHours(byMonth[m]));
  const monthsLabels = sortedMonths.map((m) => {
    const [y, mo] = m.split('-');
    return `${monthNames[parseInt(mo, 10) - 1]} ${y}`;
  });

  try {
    const savedW = localStorage.getItem('devlog_weekThreshold');
    if (savedW != null) el('weekThreshold').value = savedW;
    const savedM = localStorage.getItem('devlog_monthThreshold');
    if (savedM != null) el('monthThreshold').value = savedM;
  } catch (_) {}
  const thresholdHours = parseInt(el('weekThreshold').value, 10) || 10;
  const thresholdMonthHours = parseInt(el('monthThreshold').value, 10) || 40;

  const weekMeta = buildMeta(sortedWeeksList, formatWeekLabel, byWeekDet, thresholdHours);
  const monthMeta = buildMeta(sortedMonths, (m) => {
    const [y, mo] = m.split('-');
    return `${monthNames[parseInt(mo, 10) - 1]} ${y}`;
  }, byMonthDet, thresholdMonthHours);

  const canvasWeeks = el('chartWeeks');
  const canvasMonths = el('chartMonths');

  destroyChart(chartWeeks);
  chartWeeks = new Chart(canvasWeeks, {
    type: 'line',
    data: {
      labels: weekLabels,
      datasets: [
        createLineDataset(weeksValues),
        createThresholdDataset(thresholdHours, weekLabels.length)
      ]
    },
    options: getChartOptions()
  });
  bindCustomTooltip(chartWeeks, weekMeta);

  const thWeekInput = el('weekThreshold');
  if (thWeekInput && !thWeekInput.dataset.bound) {
    thWeekInput.dataset.bound = '1';
    thWeekInput.addEventListener('input', () => {
      try { localStorage.setItem('devlog_weekThreshold', thWeekInput.value); } catch (_) {}
      renderDashboard();
    });
  }
  const thMonthInput = el('monthThreshold');
  if (thMonthInput && !thMonthInput.dataset.bound) {
    thMonthInput.dataset.bound = '1';
    thMonthInput.addEventListener('input', () => {
      try { localStorage.setItem('devlog_monthThreshold', thMonthInput.value); } catch (_) {}
      renderDashboard();
    });
  }

  destroyChart(chartMonths);
  chartMonths = new Chart(canvasMonths, {
    type: 'line',
    data: {
      labels: monthsLabels,
      datasets: [
        createLineDataset(monthsValues),
        createThresholdDataset(thresholdMonthHours, monthsLabels.length)
      ]
    },
    options: getChartOptions()
  });
  bindCustomTooltip(chartMonths, monthMeta);
}
