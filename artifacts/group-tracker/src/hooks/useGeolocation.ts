import { useState, useEffect, useRef, useCallback } from "react";

export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export function useGeolocation(active: boolean, onUpdate: (pos: GeoPosition) => void) {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!active) {
      stopWatch();
      return;
    }

    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000,
    };

    const handleSuccess = (pos: GeolocationPosition) => {
      const gp: GeoPosition = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      setPosition(gp);
      setError(null);
      onUpdateRef.current(gp);
    };

    const handleError = (err: GeolocationPositionError) => {
      setError(err.message);
    };

    watchIdRef.current = navigator.geolocation.watchPosition(handleSuccess, handleError, options);

    return stopWatch;
  }, [active, stopWatch]);

  return { position, error };
}
