"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { PlaceResult, Coordinates } from "../types/contracts";
import { searchPlaces } from "../services/api";
import { MapPin, Search, X, Loader2, Navigation, Crosshair } from "lucide-react";

const LOCAL_LANDMARKS: PlaceResult[] = [
  {
    id: "preset_ben_thanh",
    name: "Chợ Bến Thành",
    display_name: "Chợ Bến Thành, Phường Bến Thành, Quận 1, TP. Hồ Chí Minh",
    lat: 10.7725,
    lng: 106.6980,
    type: "landmark",
    district: "Quận 1",
    city: "Thành phố Hồ Chí Minh",
    provenance: "osm.hcm_preset",
  },
  {
    id: "preset_landmark_81",
    name: "Landmark 81",
    display_name: "Tòa nhà Landmark 81, Vinhomes Central Park, Bình Thạnh, TP. Hồ Chí Minh",
    lat: 10.7950,
    lng: 106.7218,
    type: "landmark",
    district: "Bình Thạnh",
    city: "Thành phố Hồ Chí Minh",
    provenance: "osm.hcm_preset",
  },
  {
    id: "preset_hang_xanh",
    name: "Ngã tư Hàng Xanh",
    display_name: "Ngã tư Hàng Xanh, Phường 21, Bình Thạnh, TP. Hồ Chí Minh",
    lat: 10.8012,
    lng: 106.7115,
    type: "intersection",
    district: "Bình Thạnh",
    city: "Thành phố Hồ Chí Minh",
    provenance: "osm.hcm_preset",
  },
  {
    id: "preset_nguyen_huu_canh",
    name: "Đường Nguyễn Hữu Cảnh",
    display_name: "Đường Nguyễn Hữu Cảnh, Quận 1 / Bình Thạnh, TP. Hồ Chí Minh",
    lat: 10.7981,
    lng: 106.7186,
    type: "street",
    district: "Bình Thạnh",
    city: "Thành phố Hồ Chí Minh",
    provenance: "osm.hcm_preset",
  },
  {
    id: "preset_tan_son_nhat",
    name: "Sân bay Tân Sơn Nhất",
    display_name: "Cảng hàng không quốc tế Tân Sơn Nhất, Tân Bình, TP. Hồ Chí Minh",
    lat: 10.8185,
    lng: 106.6588,
    type: "airport",
    district: "Tân Bình",
    city: "Thành phố Hồ Chí Minh",
    provenance: "osm.hcm_preset",
  },
  {
    id: "preset_duc_ba",
    name: "Nhà thờ Đức Bà",
    display_name: "Nhà thờ Đức Bà Sài Gòn, Công xã Paris, Quận 1, TP. Hồ Chí Minh",
    lat: 10.7798,
    lng: 106.6990,
    type: "landmark",
    district: "Quận 1",
    city: "Thành phố Hồ Chí Minh",
    provenance: "osm.hcm_preset",
  },
];

interface PlaceSearchComboboxProps {
  label: string;
  placeholder: string;
  color: "emerald" | "rose";
  value: string;
  onChangeText: (text: string) => void;
  selectedCoordinates: Coordinates | null;
  onSelectPlace: (place: PlaceResult | null) => void;
  onLocateMe?: () => void;
  isLocating?: boolean;
  isPickingOnMap?: boolean;
  onTogglePickOnMap?: () => void;
  ariaLabel: string;
  testId?: string;
}

export const PlaceSearchCombobox: React.FC<PlaceSearchComboboxProps> = ({
  label,
  placeholder,
  color,
  value,
  onChangeText,
  selectedCoordinates,
  onSelectPlace,
  onLocateMe,
  isLocating,
  isPickingOnMap,
  onTogglePickOnMap,
  ariaLabel,
  testId,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search places
  const performSearch = useCallback(
    async (queryText: string) => {
      const clean = queryText.trim();

      // Check if user input is raw "lat, lng" coordinates
      const coordMatch = clean.match(/^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          const directPlace: PlaceResult = {
            id: `coord_${lat.toFixed(5)}_${lng.toFixed(5)}`,
            name: `Tọa độ: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            display_name: `Tọa độ [${lat.toFixed(5)}, ${lng.toFixed(5)}]`,
            lat,
            lng,
            type: "coordinate",
            provenance: "user_coordinates",
          };
          setSuggestions([directPlace]);
          setIsLoading(false);
          setIsOpen(true);
          return;
        }
      }

      if (clean.length < 3) {
        setSuggestions([]);
        setIsLoading(false);
        return;
      }

      // Check local landmarks for instant matching (0ms local latency)
      const localMatches = LOCAL_LANDMARKS.filter(
        (l) =>
          l.name.toLowerCase().includes(clean.toLowerCase()) ||
          l.display_name.toLowerCase().includes(clean.toLowerCase())
      );
      if (localMatches.length > 0) {
        setSuggestions(localMatches);
        setIsOpen(true);
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(localMatches.length === 0);
      setSearchError(null);

      try {
        const response = await searchPlaces(clean, 6, controller.signal);
        const remoteResults = response.results || [];
        // Combine local and remote results without duplicates
        const combined = [...localMatches];
        for (const r of remoteResults) {
          if (!combined.some((c) => Math.abs(c.lat - r.lat) < 1e-4 && Math.abs(c.lng - r.lng) < 1e-4)) {
            combined.push(r);
          }
        }
        setSuggestions(combined.slice(0, 8));
        setIsOpen(true);
      } catch (err: any) {
        if (err.name !== "AbortError") {
          if (localMatches.length === 0) {
            setSearchError("Không thể tải gợi ý địa điểm.");
            setSuggestions([]);
          }
        }
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    onChangeText(text);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const clean = text.trim();
    if (clean.length < 3) {
      setSuggestions([]);
      setIsOpen(false);
      setIsLoading(false);
      if (!clean) {
        onSelectPlace(null);
      }
      return;
    }

    // Synchronously match local landmarks to eliminate stale options immediately
    const localMatches = LOCAL_LANDMARKS.filter(
      (l) =>
        l.name.toLowerCase().includes(clean.toLowerCase()) ||
        l.display_name.toLowerCase().includes(clean.toLowerCase())
    );
    setSuggestions(localMatches);
    if (localMatches.length > 0) {
      setIsOpen(true);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(text);
    }, 280);
  };

  const handleSelect = (place: PlaceResult) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    onChangeText(place.name || place.display_name);
    onSelectPlace(place);
    setIsOpen(false);
    setSuggestions([]);
    setIsLoading(false);
  };

  const handleClear = () => {
    onChangeText("");
    onSelectPlace(null);
    setSuggestions([]);
    setIsOpen(false);
  };

  const badgeColor =
    color === "emerald"
      ? "bg-emerald-500 text-emerald-400 border-emerald-500/30"
      : "bg-rose-500 text-rose-400 border-rose-500/30";

  return (
    <div ref={containerRef} className="space-y-1 relative" data-testid={testId}>
      {/* Label and actions */}
      <div className="flex items-center justify-between">
        <label className={`text-[11px] font-semibold flex items-center gap-1.5 ${badgeColor.split(" ")[1]}`}>
          <span className={`w-2 h-2 rounded-full ${color === "emerald" ? "bg-emerald-500" : "bg-rose-500"}`} />
          {label}
        </label>
        <div className="flex items-center gap-1">
          {onLocateMe && (
            <button
              type="button"
              onClick={onLocateMe}
              disabled={isLocating}
              className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 px-2 py-0.5 rounded-md bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition disabled:opacity-50"
              title="Lấy vị trí GPS hiện tại của thiết bị"
            >
              {isLocating ? (
                <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
              ) : (
                <Crosshair className="w-3 h-3 text-blue-400" />
              )}
              <span>Vị trí của tôi</span>
            </button>
          )}
          {onTogglePickOnMap && (
            <button
              type="button"
              onClick={onTogglePickOnMap}
              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border transition ${
                isPickingOnMap
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/50 animate-pulse font-bold"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200 border-slate-700 hover:bg-slate-700/60"
              }`}
              title="Bật chế độ chọn điểm này trực tiếp bằng cách click trên bản đồ"
            >
              <MapPin className="w-3 h-3" />
              <span>{isPickingOnMap ? "Đang chọn trên map" : "Chọn trên map"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Input container */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
          <Search className="w-3.5 h-3.5" />
        </div>
        <input
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          value={value}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (suggestions.length > 0) {
                handleSelect(suggestions[0]);
              }
            } else if (e.key === "Escape") {
              setIsOpen(false);
            }
          }}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
            else if (value.trim().length >= 3) performSearch(value);
          }}
          placeholder={placeholder}
          className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-8 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
        />
        {isLoading && (
          <div className="absolute inset-y-0 right-2 flex items-center">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
          </div>
        )}
        {!isLoading && value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-white"
            title="Xóa tìm kiếm"
            aria-label="Xóa nội dung"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Coordinate badge if coordinate is locked */}
      {selectedCoordinates && (
        <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 px-1">
          <span className="text-slate-500">Tọa độ WGS84:</span>
          <span className="text-blue-400 font-semibold">
            {selectedCoordinates.lat.toFixed(5)}, {selectedCoordinates.lng.toFixed(5)}
          </span>
        </div>
      )}

      {/* Dropdown Suggestions */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-60 overflow-y-auto divide-y divide-slate-800"
        >
          {suggestions.length > 0 ? (
            suggestions.map((item) => (
              <div
                key={item.id}
                role="option"
                aria-selected={false}
                tabIndex={0}
                onClick={() => handleSelect(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelect(item);
                  }
                }}
                className="p-2.5 hover:bg-slate-800 cursor-pointer transition text-left flex items-start gap-2.5 focus:bg-slate-800 focus:outline-none"
              >
                <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white truncate">{item.name}</div>
                  <div className="text-[11px] text-slate-400 line-clamp-1">{item.display_name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.district && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300">
                        {item.district}
                      </span>
                    )}
                    <span className="text-[9px] text-slate-500 font-mono">
                      {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="p-3 text-center text-xs text-slate-400">
              {cleanTextState(value)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function cleanTextState(val: string): string {
  if (val.trim().length < 3) {
    return "Nhập ít nhất 3 ký tự để tìm kiếm...";
  }
  return "Không tìm thấy địa điểm phù hợp tại TP.HCM.";
}
