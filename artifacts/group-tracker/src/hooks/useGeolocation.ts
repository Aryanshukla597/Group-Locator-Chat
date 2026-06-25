import { useState, useEffect, useRef, useCallback } from "react";

export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export function useGeolocation(active: boolean, onUpdate: (pos: GeoPosition) => void) {
  const [highAccuracy, setHighAccuracy] = useState(true);
  const watchIdRef = useRef<number | null>(null);
  const failureCountRef = useRef(0);
  const hasPositionRef = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  // Check permission state before fallback (handling iOS Safari/Android Chrome differences)
  const checkPermissionAndFallback = useCallback((errCode: number) => {
    if (errCode === 1) { // PERMISSION_DENIED
      console.error("Geolocation permission denied by user");
      return;
    }

    const triggerFallback = () => {
      if (highAccuracy) {
        console.warn("Persistent GPS failure/timeout. Falling back to low accuracy mode.");
        setHighAccuracy(false);
      }
    };

    if (navigator.permissions && typeof navigator.permissions.query === "function") {
      navigator.permissions.query({ name: "geolocation" as any })
        .then((status) => {
          if (status.state === "granted") {
            // Permission is granted. Only fallback if it persistently fails/times out.
            failureCountRef.current += 1;
            if (failureCountRef.current >= 3 && !hasPositionRef.current) {
              triggerFallback();
            }
          } else {
            // Permission is not granted or prompt, fallback immediately
            triggerFallback();
          }
        })
        .catch(() => {
          failureCountRef.current += 1;
          if (failureCountRef.current >= 3 && !hasPositionRef.current) {
            triggerFallback();
          }
        });
    } else {
      // Fallback for browsers that do not support permissions query (like iOS Safari)
      failureCountRef.current += 1;
      if (failureCountRef.current >= 3 && !hasPositionRef.current) {
        triggerFallback();
      }
    }
  }, [highAccuracy]);

  // Periodically retry high accuracy mode if we fell back to low accuracy
  useEffect(() => {
    if (!highAccuracy) {
      const timer = setTimeout(() => {
        console.log("Retrying high accuracy GPS mode...");
        failureCountRef.current = 0;
        setHighAccuracy(true);
      }, 30000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [highAccuracy]);

  useEffect(() => {
    if (!active) {
      stopWatch();
      return;
    }

    if (!navigator.geolocation) {
      console.warn("Geolocation is not supported by your browser");
      return;
    }

    // Technique 2: Immediate fast one-shot fetch for low-latency startup centering
    if (!hasPositionRef.current) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!hasPositionRef.current) { // Only apply if high-accuracy watch hasn't returned yet
            const gp: GeoPosition = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            };
            onUpdateRef.current(gp);
          }
        },
        (err) => {
          console.warn("Initial fast low-accuracy fetch failed:", err.message);
        },
        {
          enableHighAccuracy: false,
          maximumAge: Infinity, // Accept cached positions for instant loading
          timeout: 2500,        // Fail fast
        }
      );
    }

    const options: PositionOptions = {
      enableHighAccuracy: highAccuracy,
      timeout: 10000, // 10 seconds timeout per GPS watch cycle
      maximumAge: 0,   // Force a fresh GPS hardware reading, no cached locations
    };

    const handleSuccess = (pos: GeolocationPosition) => {
      failureCountRef.current = 0;
      hasPositionRef.current = true;
      const gp: GeoPosition = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      onUpdateRef.current(gp);
    };

    const handleError = (err: GeolocationPositionError) => {
      console.error("Geolocation error:", err.message, "Code:", err.code);
      checkPermissionAndFallback(err.code);
    };

    watchIdRef.current = navigator.geolocation.watchPosition(handleSuccess, handleError, options);

    return stopWatch;
  }, [active, stopWatch, highAccuracy, checkPermissionAndFallback]);
}

