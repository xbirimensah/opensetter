/* Two small multiples on one shared scale, so the bars compare honestly:
   DMs sent and link clicks per day. The numbers are an illustration, and
   the chart says so in its own header. */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* Illustrative values only. Not results from any account. */
const SERIES = [
  { name: "DMs sent", values: [42, 68, 51, 94, 120, 86, 73] },
  { name: "Link clicks", values: [11, 19, 14, 30, 41, 25, 20] },
];

const SCALE_MAX = Math.max(...SERIES.flatMap((s) => s.values));

function Bars({ name, values }: { name: string; values: number[] }) {
  const total = values.reduce((sum, v) => sum + v, 0);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[0.8125rem] font-semibold">{name}</p>
        <p className="text-[0.8125rem] tabular-nums text-muted">{total.toLocaleString("en-US")} total</p>
      </div>
      <div className="site-bars mt-4" aria-hidden="true">
        {values.map((value, i) => {
          const height = Math.max((value / SCALE_MAX) * 100, 3);
          return (
            <div key={DAYS[i]} className="site-bar">
              <span style={{ height: `${height}%` }} />
              <span className="site-bar-value" style={{ bottom: `${height}%` }}>
                {DAYS[i]} {value}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-[2px] text-center text-[0.6875rem] text-muted" aria-hidden="true">
        {DAYS.map((day) => (
          <span key={day} className="flex-1">
            {day}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function WeekChart() {
  return (
    <figure className="site-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="site-subheading">Campaign activity</p>
        <span className="site-chip font-medium text-muted">Example week</span>
      </div>
      <div className="mt-6 grid gap-8 sm:grid-cols-2">
        {SERIES.map((series) => (
          <Bars key={series.name} name={series.name} values={series.values} />
        ))}
      </div>
      <figcaption className="mt-5 text-[0.75rem] text-muted">
        Illustrative data, not results from a real account.
      </figcaption>
      <table className="sr-only">
        <caption>Example week, illustrative data</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {SERIES.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day, i) => (
            <tr key={day}>
              <th scope="row">{day}</th>
              {SERIES.map((s) => (
                <td key={s.name}>{s.values[i]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
