/**
 * LineChart Component
 * ====================
 * 
 * Renders a responsive line chart for time-series data.
 * Used for: Cost trends over years, project count evolution.
 * 
 * Good for showing: trends, patterns, and changes over time.
 */

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface LineChartProps {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    color: string;
    fill?: boolean;
  }[];
  formatValue?: (value: number) => string;
}

export function LineChart({ labels, datasets, formatValue }: LineChartProps) {
  const chartData = {
    labels,
    datasets: datasets.map((ds) => ({
      label: ds.label,
      data: ds.data,
      borderColor: ds.color,
      backgroundColor: ds.fill ? ds.color + '20' : 'transparent',
      fill: ds.fill ?? false,
      tension: 0.3, // smooth curves
      pointRadius: 4,
      pointHoverRadius: 6,
    })),
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.y ?? 0;
            return `${ctx.dataset.label}: ${formatValue ? formatValue(val) : val.toLocaleString()}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function (value) {
            if (formatValue) return formatValue(Number(value));
            return value;
          },
        },
      },
    },
  };

  return (
    <div style={{ height: '300px', width: '100%' }}>
      <Line data={chartData} options={options} />
    </div>
  );
}
