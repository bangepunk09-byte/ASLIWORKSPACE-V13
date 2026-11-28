import { useMemo, useState } from "react";
import { MapPin, LocateFixed, RefreshCw, ExternalLink, Copy, Check, Radar, Clock, Navigation } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Avatar } from "./common";
import {
  resolveRadiusMeters,
  formatRadiusMeters,
  formatDistanceMeters,
  formatLocationTimeAgo,
} from "../lib/liveLocation";

function computeOsmBbox(lat, lng, radiusMeters) {
  const padMeters = Math.max((Number(radiusMeters) || 50) * 4, 300);
  const dLat = padMeters / 111320;
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLng = padMeters / (111320 * cosLat);
  return {
    minLng: (lng - dLng).toFixed(6),
    minLat: (lat - dLat).toFixed(6),
    maxLng: (lng + dLng).toFixed(6),
    maxLat: (lat + dLat).toFixed(6),
  };
}

function computeGoogleZoom(radiusMeters) {
  const r = Number(radiusMeters) || 50;
  if (r <= 40) return 17;
  if (r <= 150) return 16;
  if (r <= 500) return 15;
  if (r <= 1500) return 14;
  return 13;
}

export function LiveLocationMapDialog({
  open,
  onOpenChange,
  user,
  liveLocation,
  distanceFromYouMeters = null,
  onRefresh,
  refreshing = false,
}) {
  const [mapProvider, setMapProvider] = useState("google"); // "google" | "osm"
  const [copied, setCopied] = useState(false);

  const lat = Number(liveLocation?.lat);
  const lng = Number(liveLocation?.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const radiusMeters = resolveRadiusMeters(liveLocation);
  const radiusLabel = formatRadiusMeters(radiusMeters);
  const timeAgo = formatLocationTimeAgo(liveLocation?.updated_at);
  const distanceLabel =
    distanceFromYouMeters !== null && distanceFromYouMeters !== undefined
      ? formatDistanceMeters(distanceFromYouMeters)
      : "";

  const googleEmbedUrl = useMemo(() => {
    if (!hasCoords) return "";
    const z = computeGoogleZoom(radiusMeters);
    return `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=${z}&output=embed`;
  }, [hasCoords, lat, lng, radiusMeters]);

  const osmEmbedUrl = useMemo(() => {
    if (!hasCoords) return "";
    const box = computeOsmBbox(lat, lng, radiusMeters);
    return `https://www.openstreetmap.org/export/embed.html?bbox=${box.minLng}%2C${box.minLat}%2C${box.maxLng}%2C${box.maxLat}&layer=mapnik&marker=${lat}%2C${lng}`;
  }, [hasCoords, lat, lng, radiusMeters]);

  const externalMapsUrl = hasCoords
    ? `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`
    : "";

  const formattedClock = useMemo(() => {
    if (!liveLocation?.updated_at) return "";
    try {
      return new Date(liveLocation.updated_at).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }, [liveLocation?.updated_at]);

  const handleCopyCoords = async () => {
    if (!hasCoords) return;
    const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Koordinat disalin");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Gagal menyalin koordinat");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-surface rounded-2xl sm:rounded-3xl max-w-2xl p-0 overflow-hidden border border-border"
        data-testid="live-location-map-dialog"
      >
        <div className="px-5 pt-5 pb-3.5 border-b border-border flex items-start justify-between gap-3 pr-12">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar user={user} size={42} showStatus={false} />
            <div className="min-w-0">
              <DialogHeader className="text-left space-y-0">
                <DialogTitle className="text-base font-bold text-ink truncate">
                  Lokasi {user?.name || "Pengguna"}
                </DialogTitle>
              </DialogHeader>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-sub">
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Dalam {radiusLabel}
                </span>
                {timeAgo && (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} />
                      {timeAgo}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center rounded-lg border border-border bg-surface2/70 p-0.5 text-[11px] font-semibold shrink-0">
            <button
              type="button"
              onClick={() => setMapProvider("google")}
              className={`rounded-md px-2.5 py-1 transition-colors cursor-pointer ${
                mapProvider === "google" ? "bg-surface text-ink shadow-xs" : "text-sub hover:text-ink"
              }`}
            >
              Google Maps
            </button>
            <button
              type="button"
              onClick={() => setMapProvider("osm")}
              className={`rounded-md px-2.5 py-1 transition-colors cursor-pointer ${
                mapProvider === "osm" ? "bg-surface text-ink shadow-xs" : "text-sub hover:text-ink"
              }`}
            >
              OSM
            </button>
          </div>
        </div>

        {hasCoords ? (
          <div className="relative h-72 sm:h-80 w-full bg-surface2 overflow-hidden">
            <iframe
              key={`${mapProvider}-${lat}-${lng}-${radiusMeters}`}
              title={`Peta lokasi ${user?.name || ""}`}
              src={mapProvider === "google" ? googleEmbedUrl : osmEmbedUrl}
              className="h-full w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
            {/* Subtle radius indicator overlay badge */}
            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900/80 text-white px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md shadow-sm">
                <Radar size={12} className="text-emerald-400" />
                Area deteksi: {radiusLabel}
              </span>
              {distanceLabel && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-slate-900/80 text-white px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md shadow-sm">
                  <Navigation size={11} className="text-sky-400" />
                  {distanceLabel}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-56 items-center justify-center bg-surface2/60 text-sm text-sub">
            Koordinat peta tidak tersedia.
          </div>
        )}

        <div className="p-5 space-y-4">
          <div className="rounded-xl border border-border bg-surface2/50 p-3.5 space-y-2">
            <div className="flex items-start gap-2.5">
              <MapPin size={16} className="text-brand shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  {liveLocation?.label || "Lokasi Terdeteksi"}
                </p>
                {liveLocation?.full_address && liveLocation.full_address !== liveLocation.label && (
                  <p className="mt-0.5 text-xs text-sub leading-relaxed">
                    {liveLocation.full_address}
                  </p>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-border/60 flex flex-wrap items-center justify-between gap-2 text-xs text-sub">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  Akurasi: <strong className="text-ink">±{radiusMeters} meter</strong>
                </span>
                {formattedClock && (
                  <span>
                    Diperbarui: <strong className="text-ink">{formattedClock}</strong>
                  </span>
                )}
              </div>
              {hasCoords && (
                <button
                  type="button"
                  onClick={handleCopyCoords}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-sub hover:text-ink hover:bg-surface2 transition-colors cursor-pointer"
                >
                  {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  <span>
                    {lat.toFixed(5)}, {lng.toFixed(5)}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                data-testid="map-dialog-refresh-btn"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface hover:bg-surface2 px-3.5 text-xs font-semibold text-ink transition-colors disabled:opacity-60 cursor-pointer"
              >
                {refreshing ? (
                  <RefreshCw size={14} className="animate-spin text-brand" />
                ) : (
                  <LocateFixed size={14} className="text-brand" />
                )}
                <span>{refreshing ? "Melacak ulang…" : "Lacak Ulang"}</span>
              </button>
            )}
            {externalMapsUrl && (
              <a
                href={externalMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="map-dialog-open-gmaps"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand hover:opacity-95 px-4 text-xs font-semibold text-white transition-opacity ml-auto"
              >
                <span>Buka di Google Maps</span>
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
