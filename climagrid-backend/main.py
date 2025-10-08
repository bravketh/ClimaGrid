from __future__ import annotations

from datetime import datetime, timedelta
from math import asin, cos, radians, sin, sqrt, ceil
from typing import Dict, List, Literal, Optional
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"

MetricKey = Literal["temperature", "humidity", "precipitation", "windspeed"]

METRIC_CATALOG: Dict[MetricKey, Dict[str, str]] = {
  "temperature": {
    "label": "Air Temperature",
    "api_field": "temperature_2m",
    "unit": "°C",
  },
  "humidity": {
    "label": "Relative Humidity",
    "api_field": "relativehumidity_2m",
    "unit": "%",
  },
  "precipitation": {
    "label": "Precipitation",
    "api_field": "precipitation",
    "unit": "mm",
  },
  "windspeed": {
    "label": "Wind Speed",
    "api_field": "windspeed_10m",
    "unit": "km/h",
  },
}


class GeocodeResult(BaseModel):
  id: Optional[int] = None
  name: str
  country: Optional[str] = None
  admin1: Optional[str] = None
  latitude: float
  longitude: float
  timezone: Optional[str] = None

  @property
  def display_name(self) -> str:
    pieces = [self.name]
    if self.admin1:
      pieces.append(self.admin1)
    if self.country:
      pieces.append(self.country)
    return ", ".join(pieces)


class TimeseriesPoint(BaseModel):
  timestamp: datetime
  value: float


class BaseObservation(BaseModel):
  timestamp: datetime = Field(default_factory=datetime.utcnow)
  metric: MetricKey
  value: float
  latitude: float = Field(..., ge=-90.0, le=90.0)
  longitude: float = Field(..., ge=-180.0, le=180.0)
  location_name: Optional[str] = Field(None, max_length=120)
  source: Optional[str] = Field(None, max_length=80)
  notes: Optional[str] = Field(None, max_length=240)


class ObservationRecord(BaseObservation):
  id: str
  submitted_at: datetime


class TimeseriesResponse(BaseModel):
  metric: MetricKey
  metric_label: str
  unit: str
  latitude: float
  longitude: float
  hours_requested: int
  source: str
  points: List[TimeseriesPoint]
  user_observations: List[ObservationRecord] = Field(default_factory=list)


app = FastAPI(title="ClimaGrid API", version="0.2.0")

app.add_middleware(
  CORSMiddleware,
  allow_origins=ALLOWED_ORIGINS,
  allow_methods=["*"],
  allow_headers=["*"],
)

USER_OBSERVATIONS: List[ObservationRecord] = []


@app.get("/healthz")
async def healthz() -> Dict[str, str]:
  return {"status": "ok"}


@app.get("/")
async def root() -> Dict[str, str]:
  return {"app": "climagrid", "status": "ok"}


@app.get("/metrics")
async def available_metrics() -> Dict[str, Dict[str, str]]:
  return METRIC_CATALOG


def _haversine_distance_km(
  lat1: float, lon1: float, lat2: float, lon2: float
) -> float:
  # Haversine formula to approximate distances on Earth's surface.
  r = 6371.0  # Earth radius in kilometers.
  d_lat = radians(lat2 - lat1)
  d_lon = radians(lon2 - lon1)
  a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
  c = 2 * asin(sqrt(a))
  return r * c


def _filter_user_observations(
  latitude: float,
  longitude: float,
  metric: Optional[MetricKey],
  hours: int,
  radius_km: float = 75.0,
) -> List[ObservationRecord]:
  cutoff = datetime.utcnow() - timedelta(hours=hours)
  matches = []
  for obs in USER_OBSERVATIONS:
    if metric and obs.metric != metric:
      continue
    if obs.timestamp < cutoff:
      continue
    if _haversine_distance_km(latitude, longitude, obs.latitude, obs.longitude) > radius_km:
      continue
    matches.append(obs)
  return sorted(matches, key=lambda item: item.timestamp)


async def _fetch_hourly_data(
  metric: MetricKey, latitude: float, longitude: float, hours: int
) -> TimeseriesResponse:
  config = METRIC_CATALOG[metric]
  forecast_days = max(1, min(7, ceil(hours / 24)))
  params = {
    "latitude": latitude,
    "longitude": longitude,
    "hourly": config["api_field"],
    "forecast_days": forecast_days,
    "timezone": "UTC",
  }

  try:
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
      response = await client.get(OPEN_METEO_URL, params=params)
      response.raise_for_status()
  except httpx.HTTPError as exc:
    raise HTTPException(
      status_code=502,
      detail=f"Upstream weather provider error: {exc}",
    ) from exc

  payload = response.json()
  hourly = payload.get("hourly", {})
  timestamps = hourly.get("time")
  values = hourly.get(config["api_field"])

  if not timestamps or not values:
    raise HTTPException(
      status_code=502, detail=f"No {config['label']} data returned for location."
    )

  now = datetime.utcnow()
  cutoff = now + timedelta(hours=hours)

  points: List[TimeseriesPoint] = []
  for raw_time, raw_value in zip(timestamps, values):
    try:
      ts = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
    except ValueError:
      continue
    if ts > cutoff:
      break
    if raw_value is None:
      continue
    points.append(TimeseriesPoint(timestamp=ts, value=float(raw_value)))

  if not points:
    raise HTTPException(
      status_code=404,
      detail="No usable datapoints found for the requested window.",
    )

  return TimeseriesResponse(
    metric=metric,
    metric_label=config["label"],
    unit=config["unit"],
    latitude=latitude,
    longitude=longitude,
    hours_requested=hours,
    source="open-meteo",
    points=points[:hours],
  )


@app.get("/geocode", response_model=List[GeocodeResult])
async def geocode(
  query: str = Query(..., min_length=2, description="City or place name to search"),
  count: int = Query(5, ge=1, le=10),
) -> List[GeocodeResult]:
  params = {"name": query, "count": count, "language": "en", "format": "json"}
  try:
    async with httpx.AsyncClient(timeout=httpx.Timeout(8.0)) as client:
      response = await client.get(OPEN_METEO_GEOCODE_URL, params=params)
      response.raise_for_status()
  except httpx.HTTPError as exc:
    raise HTTPException(
      status_code=502,
      detail=f"Geocoding provider error: {exc}",
    ) from exc

  payload = response.json() or {}
  results = payload.get("results") or []
  return [GeocodeResult(**item) for item in results]


@app.get("/timeseries", response_model=TimeseriesResponse)
async def timeseries(
  metric: MetricKey = Query("temperature"),
  latitude: float = Query(..., ge=-90, le=90),
  longitude: float = Query(..., ge=-180, le=180),
  hours: int = Query(24, ge=1, le=168),
  include_user_observations: bool = Query(True),
) -> TimeseriesResponse:
  if metric not in METRIC_CATALOG:
    raise HTTPException(status_code=400, detail=f"Metric '{metric}' not supported.")

  series = await _fetch_hourly_data(metric, latitude, longitude, hours)
  if include_user_observations:
    series.user_observations = _filter_user_observations(
      latitude=latitude,
      longitude=longitude,
      metric=metric,
      hours=hours,
    )
  return series


@app.get("/observations", response_model=List[ObservationRecord])
async def list_observations(
  metric: Optional[MetricKey] = Query(None),
  latitude: Optional[float] = Query(None, ge=-90, le=90),
  longitude: Optional[float] = Query(None, ge=-180, le=180),
  radius_km: float = Query(100.0, ge=0.1, le=500.0),
  hours: int = Query(72, ge=1, le=240),
) -> List[ObservationRecord]:
  if latitude is None or longitude is None:
    data = USER_OBSERVATIONS
  else:
    data = _filter_user_observations(
      latitude=latitude,
      longitude=longitude,
      metric=metric,
      hours=hours,
      radius_km=radius_km,
    )

  filtered = []
  cutoff = datetime.utcnow() - timedelta(hours=hours)
  for obs in data:
    if metric and obs.metric != metric:
      continue
    if obs.timestamp < cutoff:
      continue
    if latitude is not None and longitude is not None:
      if _haversine_distance_km(latitude, longitude, obs.latitude, obs.longitude) > radius_km:
        continue
    filtered.append(obs)
  return sorted(filtered, key=lambda item: item.timestamp)


@app.post("/observations", response_model=ObservationRecord)
async def add_observation(obs: BaseObservation) -> ObservationRecord:
  record = ObservationRecord(
    id=str(uuid4()),
    timestamp=obs.timestamp,
    metric=obs.metric,
    value=obs.value,
    latitude=obs.latitude,
    longitude=obs.longitude,
    location_name=obs.location_name,
    source=obs.source or "user",
    notes=obs.notes,
    submitted_at=datetime.utcnow(),
  )
  USER_OBSERVATIONS.append(record)
  return record
