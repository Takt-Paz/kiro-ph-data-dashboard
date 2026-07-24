/**
 * DoughnutChart Component
 * ========================
 * 
 * Renders a doughnut (donut) chart for proportional data.
 * Used for: Cost distribution by category, work type breakdown.
 * 
 * Best for: showing parts of a whole (percentages, market share).
 * Avoid for: too many categories (>8 slices become unreadable).
 */

import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';
import { Doughnut } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend);

// Professional color palette — muted tones for white backgrounds
const COLORS = [
  '#1f2937', '#4b5563', '#0369a1', '#0f766e',
  '#7c3aed', '#b45309', '#be123c', '#4338ca',
  '#15803d', '#9333ea', '#1d4ed8', '#0891b2',
];

interface DoughnutChartProps {
  labels: string[];
  data: number[];
  formatValue?: (value: number) => string;
}

export function DoughnutChart({ labels, data, formatValue }: DoughnutChartProps) {
  const chartData = {
    labels,
    datasets: [
      {
        data,
        backgroundColor: COLORS.slice(0, data.length),
        borderColor: '#ffffff',
        borderWidth: 2,
        hoverOffset: 8,
      },
    ],
  };

  const options: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: { boxWidth: 12, padding: 12, font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed;
            const total = data.reduce((a, b) => a + b, 0);
            const pct = ((val / total) * 100).toFixed(1);
            const formatted = formatValue ? formatValue(val) : val.toLocaleString();
            return `${ctx.label}: ${formatted} (${pct}%)`;
          },
        },
      },
    },
    cutout: '55%', // Makes it a doughnut vs pie
  };

  return (
    <div style={{ height: '300px', width: '100%' }}>
      <Doughnut data={chartData} options={options} />
    </div>
  );
}
