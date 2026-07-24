import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface BarChartProps {
  labels: string[];
  data: number[];
  label: string;
  color?: string;
  horizontal?: boolean;
  formatValue?: (value: number) => string;
}

export function BarChart({
  labels,
  data,
  label,
  color = '#1f2937',
  horizontal = false,
  formatValue,
}: BarChartProps) {
  const chartData = {
    labels,
    datasets: [
      {
        label,
        data,
        backgroundColor: color + '99',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };

  const options: ChartOptions<'bar'> = {
    indexAxis: horizontal ? 'y' : 'x',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed[horizontal ? 'x' : 'y'] ?? 0;
            return formatValue ? formatValue(val) : val.toLocaleString();
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: !horizontal },
        ticks: {
          callback: function (value) {
            if (!horizontal && formatValue) return formatValue(Number(value));
            return value;
          },
        },
      },
      y: {
        grid: { display: horizontal },
        ticks: {
          callback: function (value) {
            if (horizontal && formatValue) return formatValue(Number(value));
            return value;
          },
        },
      },
    },
  };

  return (
    <div style={{ height: horizontal ? `${Math.max(labels.length * 35, 200)}px` : '300px', width: '100%' }}>
      <Bar data={chartData} options={options} />
    </div>
  );
}
