import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Compass,
  ExternalLink,
  MapPin,
  Navigation,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';

interface PlaceEntry {
  id: string;
  name: string;
  address: string;
  position: google.maps.LatLngLiteral;
  rating?: number | null;
  ratingCount?: number | null;
}

interface RouteSummary {
  distanceText: string;
  durationText: string;
  travelMode: string;
}

interface GroundedAnswer {
  content: string;
  mapPlaces: Array<{ title: string; uri: string; snippets: string[] }>;
}

const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: 37.7749, lng: -122.4194 };

function checkAndDispatchQuotaError(err: unknown) {
  const text = err instanceof Error ? err.message : String(err || '');
  if (
    text.includes('429') ||
    text.includes('RESOURCE_EXHAUSTED') ||
    text.includes('OVER_QUERY_LIMIT') ||
    text.includes('Quota')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}

function PlaceMarkerItem({
  place,
  isOrigin,
  isDestination,
  onSetOrigin,
  onSetDestination,
}: {
  place: PlaceEntry;
  isOrigin: boolean;
  isDestination: boolean;
  onSetOrigin: (p: PlaceEntry) => void;
  onSetDestination: (p: PlaceEntry) => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(false);

  const pinBg = isOrigin ? '#10b981' : isDestination ? '#ec4899' : '#22d3ee';

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={place.position}
        title={place.name}
        onClick={() => setOpen(true)}
      >
        <Pin background={pinBg} borderColor="#090d1c" glyphColor="#090d1c" />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setOpen(false)} maxWidth={260}>
          <div className="text-slate-900 space-y-1.5 p-0.5">
            <p className="font-semibold text-sm leading-snug">{place.name}</p>
            <p className="text-xs text-slate-600">{place.address}</p>
            {typeof place.rating === 'number' && (
              <p className="text-xs font-medium text-amber-700">
                Rating: {place.rating.toFixed(1)} ({place.ratingCount || 0} reviews)
              </p>
            )}
            <div className="flex gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  onSetOrigin(place);
                  setOpen(false);
                }}
                className="px-2 py-1 rounded bg-emerald-600 text-white text-[11px] font-medium cursor-pointer"
              >
                Set Origin
              </button>
              <button
                type="button"
                onClick={() => {
                  onSetDestination(place);
                  setOpen(false);
                }}
                className="px-2 py-1 rounded bg-violet-600 text-white text-[11px] font-medium cursor-pointer"
              >
                Set Destination
              </button>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

function MapsWorkspaceInner() {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const routesLib = useMapsLibrary('routes');

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  const [places, setPlaces] = useState<PlaceEntry[]>([
    {
      id: 'sf-ferry-building',
      name: 'Ferry Building Marketplace',
      address: '1 Ferry Building, San Francisco, CA',
      position: { lat: 37.7955, lng: -122.3937 },
    },
  ]);
  const [originPlace, setOriginPlace] = useState<PlaceEntry | null>(null);
  const [destinationPlace, setDestinationPlace] = useState<PlaceEntry | null>(null);
  const [travelMode, setTravelMode] = useState<'DRIVING' | 'WALKING' | 'BICYCLING' | 'TRANSIT'>(
    'DRIVING'
  );
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const activePolylinesRef = useRef<google.maps.Polyline[]>([]);

  // Gemini Maps Grounding panel
  const [aiQuery, setAiQuery] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<GroundedAnswer | null>(null);

  useEffect(() => {
    return () => {
      activePolylinesRef.current.forEach((p) => p.setMap(null));
      activePolylinesRef.current = [];
    };
  }, []);

  // AutocompleteSuggestion lookup with session token
  useEffect(() => {
    if (!placesLib || !query.trim()) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new AutocompleteSessionToken();
    }

    const timer = setTimeout(async () => {
      try {
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query.trim(),
          sessionToken: sessionTokenRef.current!,
        });
        if (!cancelled) {
          setSuggestions(res.suggestions || []);
        }
      } catch (err) {
        checkAndDispatchQuotaError(err);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [placesLib, query]);

  const handleSelectSuggestion = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      setMapError(null);
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: [
            'id',
            'displayName',
            'formattedAddress',
            'location',
            'viewport',
            'rating',
            'userRatingCount',
          ],
        });
        sessionTokenRef.current = null;
        setSuggestions([]);
        setQuery('');

        if (!place.location) return;
        const pos = {
          lat: place.location.lat(),
          lng: place.location.lng(),
        };
        const entry: PlaceEntry = {
          id: place.id || `place-${Date.now()}`,
          name: place.displayName || 'Selected Place',
          address: place.formattedAddress || '',
          position: pos,
          rating: place.rating,
          ratingCount: place.userRatingCount,
        };
        setPlaces((prev) => {
          const exists = prev.some((p) => p.id === entry.id);
          return exists ? prev : [...prev, entry];
        });
        if (!originPlace) setOriginPlace(entry);
        else setDestinationPlace(entry);

        if (map) {
          if (place.viewport) {
            map.fitBounds(place.viewport);
          } else {
            map.panTo(pos);
            map.setZoom(14);
          }
        }
      } catch (err) {
        checkAndDispatchQuotaError(err);
        setMapError(err instanceof Error ? err.message : 'Unable to fetch place details.');
      }
    },
    [placesLib, map, originPlace]
  );

  const computeRoute = async () => {
    if (!routesLib || !map || !originPlace || !destinationPlace) return;
    setRouteBusy(true);
    setMapError(null);
    activePolylinesRef.current.forEach((p) => p.setMap(null));
    activePolylinesRef.current = [];

    try {
      const response = await routesLib.Route.computeRoutes({
        origin: originPlace.position,
        destination: destinationPlace.position,
        travelMode: travelMode as google.maps.TravelMode,
        fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
      });

      const primary = response.routes?.[0];
      if (!primary) {
        setMapError('No route found between the selected points.');
        return;
      }

      const polylines = primary.createPolylines({
        polylineOptions: {
          strokeColor: '#22d3ee',
          strokeWeight: 5,
          strokeOpacity: 0.9,
        },
      });
      polylines.forEach((p) => p.setMap(map));
      activePolylinesRef.current = polylines;

      if (primary.viewport) {
        map.fitBounds(primary.viewport);
      }

      const km = ((primary.distanceMeters || 0) / 1000).toFixed(1);
      const mins = Math.max(1, Math.round((primary.durationMillis || 0) / 60000));
      setRouteSummary({
        distanceText: `${km} km`,
        durationText: `${mins} min`,
        travelMode,
      });
    } catch (err) {
      checkAndDispatchQuotaError(err);
      setMapError(err instanceof Error ? err.message : 'Route computation failed.');
    } finally {
      setRouteBusy(false);
    }
  };

  const clearRoute = () => {
    activePolylinesRef.current.forEach((p) => p.setMap(null));
    activePolylinesRef.current = [];
    setRouteSummary(null);
  };

  const askMapsGroundedAi = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = aiQuery.trim();
    if (!clean || aiBusy) return;
    setAiBusy(true);
    setMapError(null);
    try {
      const center = map?.getCenter();
      const latLng = center
        ? { latitude: center.lat(), longitude: center.lng() }
        : { latitude: DEFAULT_CENTER.lat, longitude: DEFAULT_CENTER.lng };

      const res = await apiRequest<{
        assistantMessage: {
          content: string;
          grounding?: { mapPlaces?: Array<{ title: string; uri: string; snippets: string[] }> } | null;
        };
      }>('/api/v1/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: clean,
          persona: 'Local Explorer',
          groundingMode: 'googleMaps',
          latLng,
        }),
      });
      setAiAnswer({
        content: res.assistantMessage.content,
        mapPlaces: res.assistantMessage.grounding?.mapPlaces || [],
      });
    } catch (err) {
      setMapError(err instanceof Error ? err.message : 'Maps AI query failed.');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0">
      {/* Left Interactive Controls & Grounded Places Drawer */}
      <aside className="w-full lg:w-96 border-b lg:border-b-0 lg:border-r border-white/10 bg-[#090d1c]/90 p-4 flex flex-col gap-4 overflow-y-auto shrink-0">
        <div>
          <h2 className="text-base font-display font-bold text-white flex items-center gap-2">
            <Compass className="w-4 h-4 text-cyan-400" />
            Google Maps Explorer
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Places Autocomplete, Routes API & Gemini Maps Grounding
          </p>
        </div>

        {/* Places Autocomplete Search */}
        <div className="relative">
          <div className="flex items-center gap-2 h-10 rounded-xl bg-[#0e1428] border border-white/15 px-3">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any address or landmark..."
              className="w-full bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          {suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-11 z-30 rounded-xl bg-[#0b1124] border border-white/15 shadow-xl max-h-52 overflow-y-auto divide-y divide-white/5">
              {suggestions.map((s, i) => (
                <li
                  key={i}
                  onClick={() => handleSelectSuggestion(s)}
                  className="px-3 py-2 text-xs text-slate-200 hover:bg-violet-600/25 cursor-pointer"
                >
                  {s.placePrediction?.text.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Route Planner */}
        <div className="rounded-2xl bg-[#0e1428] border border-white/10 p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-cyan-400" />
              Route Planner
            </span>
            {routeSummary && (
              <button
                type="button"
                onClick={clearRoute}
                className="text-[11px] text-slate-400 hover:text-rose-300 inline-flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="rounded-lg bg-[#090d1c] border border-white/10 px-2.5 py-1.5 flex items-center justify-between gap-2">
              <span className="text-emerald-400 font-medium">Origin:</span>
              <span className="text-slate-200 truncate">
                {originPlace ? originPlace.name : 'Click a pin or search'}
              </span>
            </div>
            <div className="rounded-lg bg-[#090d1c] border border-white/10 px-2.5 py-1.5 flex items-center justify-between gap-2">
              <span className="text-pink-400 font-medium">Dest:</span>
              <span className="text-slate-200 truncate">
                {destinationPlace ? destinationPlace.name : 'Click a second pin'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {(['DRIVING', 'WALKING', 'BICYCLING', 'TRANSIT'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTravelMode(mode)}
                className={`py-1.5 rounded-lg text-[10px] font-medium cursor-pointer border transition-colors ${
                  travelMode === mode
                    ? 'bg-cyan-600/30 border-cyan-400/60 text-white'
                    : 'bg-[#090d1c] border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                {mode.slice(0, 5)}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!originPlace || !destinationPlace || routeBusy}
            onClick={computeRoute}
            className="w-full h-9 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
          >
            {routeBusy ? 'Computing Route...' : 'Compute Route'}
          </button>

          {routeSummary && (
            <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 flex items-center justify-between text-xs text-cyan-200 font-mono-tabular">
              <span>{routeSummary.distanceText}</span>
              <span>{routeSummary.durationText}</span>
            </div>
          )}
        </div>

        {/* Gemini Maps Grounding Quick Discovery */}
        <form
          onSubmit={askMapsGroundedAi}
          className="rounded-2xl bg-[#0e1428] border border-white/10 p-3.5 space-y-2.5"
        >
          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            Ask Gemini About This Area
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              placeholder="e.g., Best ramen spots nearby"
              className="flex-1 h-9 rounded-lg bg-[#090d1c] border border-white/10 px-2.5 text-xs text-white focus:outline-none focus:border-violet-400/60"
            />
            <button
              type="submit"
              disabled={aiBusy || !aiQuery.trim()}
              className="h-9 px-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-white text-xs font-medium cursor-pointer"
            >
              {aiBusy ? '...' : 'Ask'}
            </button>
          </div>

          {aiAnswer && (
            <div className="space-y-2 pt-1 max-h-56 overflow-y-auto">
              <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                {aiAnswer.content}
              </p>
              {aiAnswer.mapPlaces.map((mp, idx) => (
                <div
                  key={`${mp.uri}-${idx}`}
                  className="rounded-lg bg-[#090d1c] border border-white/10 p-2 space-y-1"
                >
                  <a
                    href={mp.uri}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-emerald-300 hover:underline inline-flex items-center gap-1"
                  >
                    <MapPin className="w-3 h-3" />
                    {mp.title}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {mp.snippets.map((sn, sIdx) => (
                    <p key={sIdx} className="text-[11px] text-slate-400">
                      “{sn}”
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </form>

        {mapError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            {mapError}
          </div>
        )}
      </aside>

      {/* Live Map Viewport */}
      <div className="flex-1 min-h-[380px] relative">
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={12}
          gestureHandling="greedy"
          disableDefaultUI={false}
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
        >
          {places.map((p) => (
            <PlaceMarkerItem
              key={p.id}
              place={p}
              isOrigin={originPlace?.id === p.id}
              isDestination={destinationPlace?.id === p.id}
              onSetOrigin={setOriginPlace}
              onSetDestination={setDestinationPlace}
            />
          ))}
        </GoogleMap>
      </div>
    </div>
  );
}

export function MapsExplorerPanel() {
  const [apiKey, setApiKey] = useState<string>(
    () => (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  );
  const [loadingKey, setLoadingKey] = useState(!apiKey);

  useEffect(() => {
    if (apiKey) return;
    let active = true;
    apiRequest<{ apiKey: string }>('/api/v1/ai/maps-config')
      .then((res) => {
        if (active && res.apiKey) setApiKey(res.apiKey);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingKey(false);
      });
    return () => {
      active = false;
    };
  }, [apiKey]);

  if (loadingKey) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
        Loading Google Maps configuration...
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <div className="max-w-md nexora-surface rounded-2xl p-6 border border-white/10 space-y-3">
          <MapPin className="w-8 h-8 text-cyan-400 mx-auto" />
          <h2 className="text-base font-display font-semibold text-white">
            Google Maps API Key Required
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Set <span className="font-mono-tabular text-cyan-300">VITE_GOOGLE_MAPS_API_KEY</span> in
            Settings &gt; Secrets (or restart the preview container after Maps provisioning) to render the interactive map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider
      apiKey={apiKey}
      language="en"
      region="US"
      libraries={['places', 'routes', 'marker']}
    >
      <MapsWorkspaceInner />
    </APIProvider>
  );
}
