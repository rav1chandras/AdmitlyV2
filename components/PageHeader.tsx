interface PageHeaderProps {
  kicker: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({ kicker, title, subtitle, action, className = '' }: PageHeaderProps) {
  return (
    <header className={`h-24 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6 flex-shrink-0 ${className}`}>
      <div className="min-w-0">
        <div className="text-xs font-bold tracking-[0.25em] text-blue-600 uppercase">{kicker}</div>
        <div className="flex items-baseline gap-2">
          <h1 className="text-3xl lg:text-4xl font-black text-slate-900 truncate">{title}</h1>
          <span className="text-3xl lg:text-4xl font-black text-blue-600">.</span>
        </div>
        {subtitle && (
          <p className="text-sm text-slate-500 hidden md:block">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2 flex-shrink-0">{action}</div>}
    </header>
  );
}
