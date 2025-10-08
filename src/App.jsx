import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import "./App.css";

const PALETTE = {
  temperature: {
    line: "#f97316",
    fill: "rgba(249,115,22,0.18)",
    marker: "#fb923c",
    markerBorder: "#c2410c",
    highlight: "rgba(249,115,22,0.14)",
  },
  humidity: {
    line: "#0ea5e9",
    fill: "rgba(14,165,233,0.22)",
    marker: "#38bdf8",
    markerBorder: "#0c4a6e",
    highlight: "rgba(14,165,233,0.15)",
  },
  precipitation: {
    line: "#6366f1",
    fill: "rgba(99,102,241,0.2)",
    marker: "#818cf8",
    markerBorder: "#312e81",
    highlight: "rgba(99,102,241,0.16)",
  },
  windspeed: {
    line: "#22d3ee",
    fill: "rgba(34,211,238,0.18)",
    marker: "#2dd4bf",
    markerBorder: "#0f766e",
    highlight: "rgba(34,211,238,0.14)",
  },
};

function TimeseriesChart({ series, height = "60vh" }) {
  if (!series || !series.points?.length) {
    return (
      <div className="chart-placeholder">
        No data available for this selection yet.
      </div>
    );
  }

  const colors = PALETTE[series.metric] ?? {
    line: "#2563eb",
    fill: "rgba(37,99,235,0.18)",
    marker: "#60a5fa",
    markerBorder: "#1d4ed8",
    highlight: "rgba(37,99,235,0.12)",
  };

  const forecastX = series.points.map((point) => point.timestamp);
  const forecastY = series.points.map((point) => point.value);
  const userObservations = series.user_observations ?? [];
  const title = `${series.metric_label} (${series.unit})`;
  const highlightStart =
    forecastX.length > 6 ? forecastX[forecastX.length - 6] : forecastX[0];
  const highlightEnd = forecastX.at(-1);
  const latestForecast = forecastY.at(-1);
  const latestTimestamp = forecastX.at(-1);

  const traces = [
    {
      name: "Forecast • Open-Meteo",
      x: forecastX,
      y: forecastY,
      type: "scatter",
      mode: "lines",
      line: { color: colors.line, width: 3, shape: "spline", smoothing: 0.45 },
      fill: "tozeroy",
      fillcolor: colors.fill,
      hovertemplate: `<b>%{x}</b><br>${series.metric_label}: %{y:.2f} ${series.unit}<extra></extra>`,
    },
  ];

  if (userObservations.length) {
    traces.push({
      name: "Community observations",
      x: userObservations.map((point) => point.timestamp),
      y: userObservations.map((point) => point.value),
      type: "scatter",
      mode: "markers",
      marker: {
        color: colors.marker,
        size: 11,
        symbol: "star",
        line: { color: colors.markerBorder, width: 1.6 },
      },
      hovertemplate:
        "<b>%{x}</b><br>Community: %{y:.2f} " +
        `${series.unit}<br>%{text}<extra></extra>`,
      text: userObservations.map((point) => point.notes || "No additional notes"),
    });
  }

  return (
    <Plot
      data={traces}
      layout={{
        title: {
          text: title,
          font: {
            family: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
            size: 20,
            color: "#0f172a",
          },
        },
        legend: {
          orientation: "h",
          x: 0.02,
          y: 1.12,
          bgcolor: "rgba(248,250,255,0.8)",
          bordercolor: "rgba(148,163,184,0.4)",
          borderwidth: 1,
        },
        xaxis: {
          title: "Time (UTC)",
          type: "date",
          tickformat: "%H:%M\n%b %d",
          showgrid: true,
          gridcolor: "rgba(148,163,184,0.35)",
          zeroline: false,
        },
        yaxis: {
          title,
          zeroline: false,
          showgrid: true,
          gridcolor: "rgba(191,219,254,0.55)",
          ticksuffix: ` ${series.unit}`,
        },
        margin: { l: 70, r: 30, t: 70, b: 90 },
        paper_bgcolor: "rgba(248,250,255,0.92)",
        plot_bgcolor: "rgba(248,250,255,0.92)",
        hoverlabel: {
          bgcolor: "#0f172a",
          font: { color: "#f8fafc" },
          bordercolor: colors.line,
        },
        shapes:
          highlightStart && highlightEnd
            ? [
                {
                  type: "rect",
                  xref: "x",
                  yref: "paper",
                  x0: highlightStart,
                  x1: highlightEnd,
                  y0: 0,
                  y1: 1,
                  fillcolor: colors.highlight,
                  line: { width: 0 },
                },
              ]
            : [],
        annotations:
          latestForecast && latestTimestamp
            ? [
                {
                  x: latestTimestamp,
                  y: latestForecast,
                  xanchor: "left",
                  yanchor: "middle",
                  text: `${latestForecast.toFixed(1)} ${series.unit}`,
                  font: { size: 13, color: colors.line, family: "Inter, sans-serif" },
                  bgcolor: "rgba(255,255,255,0.9)",
                  bordercolor: colors.line,
                  borderwidth: 1,
                  borderpad: 6,
                  ay: -35,
                  arrowsize: 0.8,
                  arrowwidth: 1.5,
                  arrowcolor: colors.line,
                },
              ]
            : [],
      }}
      config={{
        responsive: true,
        displayModeBar: false,
      }}
      style={{ width: "100%", height }}
      useResizeHandler
      className="timeseries-chart"
    />
  );
}

const LOCAL_METRICS = {
  temperature: {
    label: "Air Temperature",
    unit: "°C",
  },
  humidity: {
    label: "Relative Humidity",
    unit: "%",
  },
  precipitation: {
    label: "Precipitation",
    unit: "mm",
  },
  windspeed: {
    label: "Wind Speed",
    unit: "km/h",
  },
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";
const DEFAULT_HOURS = 24;
const SEARCH_DEBOUNCE_MS = 400;

const toLocalDateTimeInput = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatCoordinate = (value, axis) => {
  const direction =
    axis === "lat"
      ? value >= 0
        ? "N"
        : "S"
      : value >= 0
      ? "E"
      : "W";
  return `${Math.abs(value).toFixed(2)}° ${direction}`;
};

const formatLocationName = (entry) => {
  if (!entry) return "";
  const parts = [entry.name];
  if (entry.admin1) parts.push(entry.admin1);
  if (entry.country) parts.push(entry.country);
  return parts.filter(Boolean).join(", ");
};

export default function App() {
  const [metricCatalog, setMetricCatalog] = useState(LOCAL_METRICS);
  const [selectedMetric, setSelectedMetric] = useState("temperature");
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [series, setSeries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);

  const [observationMetric, setObservationMetric] = useState("temperature");
  const [observationValue, setObservationValue] = useState("");
  const [observationNotes, setObservationNotes] = useState("");
  const [observationTimestamp, setObservationTimestamp] = useState(() =>
    toLocalDateTimeInput(new Date()),
  );
  const [observationStatus, setObservationStatus] = useState({
    message: "",
    tone: "info",
  });

  const metricOptions = useMemo(
    () =>
      Object.entries(metricCatalog).map(([key, value]) => ({
        key,
        label: value.label ?? key,
        unit: value.unit ?? "",
      })),
    [metricCatalog],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadMetricCatalog() {
      try {
        const res = await fetch(`${API_BASE}/metrics`);
        if (!res.ok) throw new Error(`Failed to load metric catalog (${res.status})`);
        const catalog = await res.json();
        if (!cancelled && catalog && typeof catalog === "object") {
          setMetricCatalog(catalog);
        }
      } catch (err) {
        console.warn("Unable to fetch metric catalog:", err);
      }
    }

    loadMetricCatalog();
    return () => {
      cancelled = true;
    };
  }, [API_BASE]);

  useEffect(() => {
    if (!searchTerm || searchTerm.length < 3) {
      setSearchResults([]);
      setSearching(false);
      return undefined;
    }

    if (
      selectedLocation &&
      searchTerm.trim().toLowerCase() === formatLocationName(selectedLocation).toLowerCase()
    ) {
      setSearchResults([]);
      setSearching(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `${API_BASE}/geocode?${new URLSearchParams({
            query: searchTerm,
            count: "8",
          }).toString()}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
        const payload = await res.json();
        setSearchResults(Array.isArray(payload) ? payload : []);
      } catch (err) {
        if (!controller.signal.aborted) {
          console.warn("Geocoding error:", err);
          setSearchResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
      setSearching(false);
    };
  }, [searchTerm, API_BASE, selectedLocation]);

  useEffect(() => {
    if (!selectedLocation) return;

    const controller = new AbortController();
    let cancelled = false;

    async function loadTimeseries() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          metric: selectedMetric,
          latitude: String(selectedLocation.latitude),
          longitude: String(selectedLocation.longitude),
          hours: String(hours),
          include_user_observations: "true",
        });

        const res = await fetch(`${API_BASE}/timeseries?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Weather request failed (HTTP ${res.status})`);
        const payload = await res.json();
        if (!cancelled) {
          setSeries(payload);
        }
      } catch (err) {
        if (!controller.signal.aborted && !cancelled) {
          setError(err.message ?? "Unable to load weather data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadTimeseries();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedLocation, selectedMetric, hours, refreshToken, API_BASE]);

  useEffect(() => {
    setObservationMetric(selectedMetric);
  }, [selectedMetric]);

  useEffect(() => {
    setObservationStatus({ message: "", tone: "info" });
  }, [selectedLocation]);

  const resetObservationForm = () => {
    setObservationValue("");
    setObservationNotes("");
    setObservationTimestamp(toLocalDateTimeInput(new Date()));
  };

  const handleObservationSubmit = async (event) => {
    event.preventDefault();
    if (!selectedLocation) {
      setObservationStatus({
        message: "Select a location first.",
        tone: "error",
      });
      return;
    }
    const numericValue = Number(observationValue);
    if (Number.isNaN(numericValue)) {
      setObservationStatus({
        message: "Enter a numeric reading.",
        tone: "error",
      });
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/observations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestamp: new Date(observationTimestamp).toISOString(),
          metric: observationMetric,
          value: numericValue,
          latitude: selectedLocation.latitude,
          longitude: selectedLocation.longitude,
          location_name: formatLocationName(selectedLocation),
          source: "community",
          notes: observationNotes || undefined,
        }),
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        const message = detail?.detail || `Submission failed (${res.status})`;
        throw new Error(message);
      }

      setObservationStatus({
        message: "Observation saved. Thank you for contributing!",
        tone: "success",
      });
      resetObservationForm();
      setRefreshToken((token) => token + 1);
    } catch (err) {
      setObservationStatus({
        message: err.message ?? "Unable to save observation.",
        tone: "error",
      });
    }
  };

  const selectedMetricMeta = metricCatalog[selectedMetric] ?? LOCAL_METRICS[selectedMetric];
  const latestPoint = series?.points?.at(-1);
  const communityObservations = series?.user_observations ?? [];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>ClimaGrid</h1>
          <p className="subtitle">
            Global climate intelligence with community-grounded truth.
          </p>
        </div>
        <span className="live-indicator">Live</span>
      </header>

      <section className="panel controls">
        <div className="control search-control">
          <label htmlFor="search">Find a city</label>
          <input
            id="search"
            type="search"
            placeholder="Search any city, country, or landmark"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            autoComplete="off"
          />
          {searching && <span className="hint">Searching…</span>}
          {!searching && searchResults.length > 0 && (
            <ul className="search-results">
              {searchResults.map((result) => {
                const display = formatLocationName(result);
                return (
                  <li key={`${result.latitude}-${result.longitude}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedLocation({ ...result, display });
                        setSearchTerm(display);
                        setSearchResults([]);
                        setSearching(false);
                      }}
                    >
                      <span>{display}</span>
                      <span className="muted">
                        {formatCoordinate(result.latitude, "lat")} ·{" "}
                        {formatCoordinate(result.longitude, "lon")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="control">
          <label htmlFor="metric">Metric</label>
          <select
            id="metric"
            value={selectedMetric}
            onChange={(event) => setSelectedMetric(event.target.value)}
          >
            {metricOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="control">
          <label htmlFor="hours">Forecast Horizon (hrs)</label>
          <input
            id="hours"
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (Number.isNaN(parsed)) return;
              const clamped = Math.min(168, Math.max(1, parsed));
              setHours(clamped);
            }}
          />
        </div>
      </section>

      {selectedLocation && (
        <section className="panel snapshot">
          <div>
            <p className="snapshot-heading">Location</p>
            <p className="snapshot-value">
              {formatLocationName(selectedLocation) || "Unnamed position"}
            </p>
            {selectedLocation.timezone && (
              <span className="muted">Time zone: {selectedLocation.timezone}</span>
            )}
          </div>

          <div>
            <p className="snapshot-heading">Coordinates</p>
            <p className="snapshot-value">
              {formatCoordinate(selectedLocation.latitude, "lat")} ·{" "}
              {formatCoordinate(selectedLocation.longitude, "lon")}
            </p>
          </div>

          <div>
            <p className="snapshot-heading">Metric</p>
            <p className="snapshot-value">
              {selectedMetricMeta?.label ?? selectedMetric}
              <span className="muted">
                {" "}
                ({selectedMetricMeta?.unit ?? ""})
              </span>
            </p>
          </div>

          <div>
            <p className="snapshot-heading">Latest Forecast</p>
            <p className="snapshot-value">
              {latestPoint
                ? `${latestPoint.value.toFixed(1)} ${series?.unit ?? ""}`
                : "—"}
            </p>
            {latestPoint && (
              <span className="muted">
                as of {new Date(latestPoint.timestamp).toLocaleString()}
              </span>
            )}
          </div>
        </section>
      )}

      <section className="panel chart-panel">
        {!selectedLocation && (
          <div className="status">Search for a location to see the forecast.</div>
        )}
        {loading && <div className="status">Fetching latest readings…</div>}
        {error && !loading && <div className="status error">{error}</div>}
        {!loading && !error && selectedLocation && <TimeseriesChart series={series} />}
      </section>

      {selectedLocation && (
        <section className="panel observation-panel">
          <div className="observation-column">
            <h2>Report the actual weather</h2>
            <p className="muted">
              Crowd-source truth to challenge inaccurate forecasts. Share what you&apos;re
              experiencing on the ground.
            </p>

            <form className="observation-form" onSubmit={handleObservationSubmit}>
              <div className="form-row">
                <label htmlFor="observation-metric">Metric</label>
                <select
                  id="observation-metric"
                  value={observationMetric}
                  onChange={(event) => setObservationMetric(event.target.value)}
                >
                  {metricOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <label htmlFor="observation-value">Value</label>
                <input
                  id="observation-value"
                  type="number"
                  step="0.1"
                  placeholder="Enter your reading"
                  value={observationValue}
                  onChange={(event) => setObservationValue(event.target.value)}
                  required
                />
              </div>

              <div className="form-row">
                <label htmlFor="observation-timestamp">Observed at</label>
                <input
                  id="observation-timestamp"
                  type="datetime-local"
                  value={observationTimestamp}
                  max={toLocalDateTimeInput(new Date())}
                  onChange={(event) => setObservationTimestamp(event.target.value)}
                  required
                />
              </div>

              <div className="form-row">
                <label htmlFor="observation-notes">Notes (optional)</label>
                <textarea
                  id="observation-notes"
                  rows={3}
                  placeholder="Describe conditions (rain intensity, wind gusts, heat index, etc.)"
                  value={observationNotes}
                  onChange={(event) => setObservationNotes(event.target.value)}
                />
              </div>

              <button type="submit" className="primary">
                Submit observation
              </button>
              {observationStatus.message && (
                <p className={`submission-status ${observationStatus.tone}`}>
                  {observationStatus.message}
                </p>
              )}
            </form>
          </div>

          <div className="observation-column">
            <h2>Community ground truth</h2>
            {communityObservations.length === 0 ? (
              <p className="muted">
                Be the first to add a reading for {formatLocationName(selectedLocation)}.
              </p>
            ) : (
              <ul className="observation-feed">
                {communityObservations.map((obs) => (
                  <li key={obs.id}>
                    <div className="feed-row">
                      <strong>
                        {obs.value.toFixed(1)} {metricCatalog[obs.metric]?.unit ?? ""}
                      </strong>
                      <span className="feed-time">
                        {new Date(obs.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="feed-meta">
                      <span className="chip">{metricCatalog[obs.metric]?.label ?? obs.metric}</span>
                      <span className="chip secondary">
                        {formatCoordinate(obs.latitude, "lat")} ·{" "}
                        {formatCoordinate(obs.longitude, "lon")}
                      </span>
                    </div>
                    {obs.notes && <p className="feed-notes">{obs.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <footer className="data-footer">
        <span>
          Data source: <strong>Open-Meteo API</strong> &amp; ClimaGrid community
        </span>
        <span>
          Backend: <code>{API_BASE}</code>
        </span>
      </footer>
    </div>
  );
}
