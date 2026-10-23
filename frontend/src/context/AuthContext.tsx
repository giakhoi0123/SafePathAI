"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export interface SavedPlace {
  id: string;
  label: "Nhà" | "Cơ quan" | "Trường học" | "Khác";
  name: string;
  lat: number;
  lng: number;
}

export interface RouteHistoryItem {
  id: string;
  originName: string;
  destName: string;
  distanceKm: number;
  durationMins: number;
  timestamp: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar: string;
  vehicle: "motorcycle" | "car";
  rainAlertsEnabled: boolean;
  tideAlertsEnabled: boolean;
  savedPlaces: SavedPlace[];
  history: RouteHistoryItem[];
}

interface AuthContextType {
  user: UserProfile | null;
  isConfigured: boolean;
  loginWithGoogle: () => Promise<void>;
  loginDemo: () => void;
  logout: () => void;
  updateVehicle: (vehicle: "motorcycle" | "car") => void;
  savePlace: (place: Omit<SavedPlace, "id">) => void;
  removeSavedPlace: (id: string) => void;
  addRouteHistory: (item: Omit<RouteHistoryItem, "id" | "timestamp">) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY = "safepath.user_profile";

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setUser(JSON.parse(saved));
      }
    } catch (e) {
      console.warn("Could not read user profile from storage:", e);
    }
  }, []);

  const saveToStorage = (profile: UserProfile | null) => {
    setUser(profile);
    if (profile) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const loginWithGoogle = async () => {
    if (!isConfigured) {
      // Graceful fallback to verified demo user when OAuth credentials are not provided
      loginDemo();
      return;
    }
    // Real Google OAuth redirect or SDK prompt when credentials present
    window.location.href = `/api/auth/signin/google`;
  };

  const loginDemo = () => {
    const demoProfile: UserProfile = {
      id: "usr_google_hcm_01",
      name: "Nguyễn Văn An",
      email: "an.nguyen@example.com",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
      vehicle: "motorcycle",
      rainAlertsEnabled: true,
      tideAlertsEnabled: true,
      savedPlaces: [
        { id: "sp_1", label: "Nhà", name: "Chợ Bến Thành (Quận 1)", lat: 10.7725, lng: 106.6980 },
        { id: "sp_2", label: "Cơ quan", name: "Landmark 81 (Bình Thạnh)", lat: 10.7950, lng: 106.7218 },
      ],
      history: [
        {
          id: "hist_1",
          originName: "Chợ Bến Thành",
          destName: "Ngã tư Hàng Xanh",
          distanceKm: 4.5,
          durationMins: 12.0,
          timestamp: new Date(Date.now() - 3600000).toISOString(),
        },
      ],
    };
    saveToStorage(demoProfile);
  };

  const logout = () => {
    saveToStorage(null);
  };

  const updateVehicle = (vehicle: "motorcycle" | "car") => {
    if (!user) return;
    saveToStorage({ ...user, vehicle });
  };

  const savePlace = (place: Omit<SavedPlace, "id">) => {
    if (!user) return;
    const newPlace: SavedPlace = { ...place, id: `sp_${Date.now()}` };
    saveToStorage({ ...user, savedPlaces: [...user.savedPlaces, newPlace] });
  };

  const removeSavedPlace = (id: string) => {
    if (!user) return;
    saveToStorage({
      ...user,
      savedPlaces: user.savedPlaces.filter((p) => p.id !== id),
    });
  };

  const addRouteHistory = (item: Omit<RouteHistoryItem, "id" | "timestamp">) => {
    if (!user) return;
    const historyItem: RouteHistoryItem = {
      ...item,
      id: `hist_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    saveToStorage({
      ...user,
      history: [historyItem, ...user.history.slice(0, 19)],
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isConfigured,
        loginWithGoogle,
        loginDemo,
        logout,
        updateVehicle,
        savePlace,
        removeSavedPlace,
        addRouteHistory,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

