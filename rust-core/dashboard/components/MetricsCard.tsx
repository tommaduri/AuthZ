interface MetricsCardProps {
  title: string;
  value: string;
  icon: string;
  trend?: string;
}

export default function MetricsCard({ title, value, icon, trend }: MetricsCardProps) {
  const isPositive = trend?.startsWith('+');

  return (
    <div className="card-glass rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-2xl">{icon}</span>
        {trend && (
          <span className={`text-sm font-semibold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {trend}
          </span>
        )}
      </div>
      <h3 className="text-gray-400 text-sm mb-1">{title}</h3>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}
