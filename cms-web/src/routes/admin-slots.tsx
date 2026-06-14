import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Clock, Plus, Pencil, X, Calendar, Check, Eye, Trash2, Ban, Power } from "lucide-react";
import { AdminLayout, getExactRoleType } from "./admin-orders";
import {
  type ItemCategory,
  type ItemType,
  type Slot,
  type MenuItem,
  type SlotMenuItemWrite,
  formatINR,
} from "@/lib/store";
import {
  fetchSlots,
  fetchSlotById,
  createSlot,
  updateSlot,
  deleteSlot,
  toggleSlotItem,
  closeSlot,
  toggleSlotActive,
} from '@/api/slotapi';
import { canteenApi, menuItemApi, type ApiCanteen, type ApiMenuItem } from "@/api/menu";
import { getCurrentUser } from "@/lib/auth";
import { getClaimsFromStorage } from "@/lib/authStorage";
import { toast } from "sonner";

export const Route = createFileRoute("/admin-slots")({ component: AdminSlots });

const CATEGORIES_BY_TYPE: Partial<Record<ItemType, ItemCategory[]>> = {
  Breakfast: ["Beverages", "Veg"],
  Meal: ["Veg", "Non-Veg", "Beverages"],
  Lunch: ["Veg", "Non-Veg", "Beverages"],
  Dinner: ["Veg", "Non-Veg", "Beverages"],
  Snacks: ["Veg", "Beverages", "Snacks"],
  Dessert: ["Desserts", "Veg"],
  Beverages: ["Beverages"],
  Other: ["Veg", "Non-Veg", "Beverages"],
};

function normalizeCategory(value: string): ItemCategory {
  const normal = value.trim().toLowerCase();
  if (normal.includes("non")) return "Non-Veg";
  if (normal.includes("beverage") || normal.includes("drink")) return "Beverages";
  if (normal.includes("dessert") || normal.includes("sweet")) return "Desserts";
  if (normal.includes("snack")) return "Snacks";
  return "Veg";
}

function formatMinutesAsTime(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function toSlotMenuItem(item: ApiMenuItem): MenuItem {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    price: Number(item.base_price),
    category: normalizeCategory(item.category_name || item.category?.name || ""),
    type: item.item_type === "BREAKFAST" ? "Breakfast" : "Meal",
    available: item.is_available && item.is_active,
    image: item.photo_url,
    tag: item.display_tag,
  };
}

function AdminSlots() {
  const currentUser = getCurrentUser();
  const claims = getClaimsFromStorage<{ canteen_id?: string }>();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [viewItemsSlot, setViewItemsSlot] = useState<Slot | null>(null);
  const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
  const [now, setNow] = useState(new Date());
  const [canteens, setCanteens] = useState<ApiCanteen[]>([]);
  const [selectedCanteenId, setSelectedCanteenId] = useState(() => localStorage.getItem("canteen_selected_id") || "");
  const [isCanteenLoading, setIsCanteenLoading] = useState(true);
  const roleType = getExactRoleType(currentUser);
  const assignedCanteenId = currentUser?.canteenId || claims?.canteen_id || "";
  const canShowCanteenSelect = roleType !== "LIMITED_ADMIN";

  useEffect(() => {
    if (!selectedCanteenId) {
      setSlots([]);
      setMenuItems([]);
      return;
    }

    localStorage.setItem("canteen_selected_id", selectedCanteenId);
    loadSlots(selectedCanteenId);
    loadMenuItems(selectedCanteenId);
  }, [selectedCanteenId]);

  const loadCanteens = useCallback(async () => {
    setIsCanteenLoading(true);
    try {
      const response = await canteenApi.list();
      const list = response.results ?? [];
      const visibleCanteens =
        canShowCanteenSelect || !assignedCanteenId
          ? list
          : list.filter((canteen) => canteen.id === assignedCanteenId);
      setCanteens(visibleCanteens);

      const stored = canShowCanteenSelect ? localStorage.getItem("canteen_selected_id") || "" : "";
      const next = canShowCanteenSelect
        ? visibleCanteens.some((canteen) => canteen.id === stored)
          ? stored
          : visibleCanteens[0]?.id ?? ""
        : assignedCanteenId || (visibleCanteens[0]?.id ?? "");
      setSelectedCanteenId(next);
      if (next) localStorage.setItem("canteen_selected_id", next);
    } catch (error) {
      console.error("Failed to fetch canteens:", error);
      setCanteens([]);
      setSelectedCanteenId("");
      toast.error("Failed to load canteens.");
    } finally {
      setIsCanteenLoading(false);
    }
  }, [assignedCanteenId, canShowCanteenSelect]);

  useEffect(() => {
    loadCanteens();
  }, [loadCanteens]);

  const loadSlots = async (canteenId: string) => {
    try {
      const response = await fetchSlots(canteenId);
      setSlots(response.data || []);
    } catch (error) {
      console.error("Failed to fetch slots:", error);
      setSlots([]);
    }
  };

  const loadMenuItems = async (canteenId: string) => {
    try {
      const response = await menuItemApi.list(canteenId, { is_available: true });
      setMenuItems(response.results.map(toSlotMenuItem));
    } catch (error) {
      console.error("Failed to fetch menu items:", error);
      setMenuItems([]);
    }
  };

  const computedSlots = useMemo(() => {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();

    return slots.map((s) => {
      const slotDate = parseLocalDate(s.date);
      const [startH, startM] = s.startTime.split(":").map(Number);
      const startTotalMinutes = startH * 60 + startM;
      const closeTotalMinutes = Math.max(0, startTotalMinutes - Number(s.bufferMinutes ?? 0));

      let computedStatus = s.status;
      let statusColor = "bg-muted text-muted-foreground";

      if (!s.active || slotDate < today) {
        computedStatus = "expired";
        statusColor = "bg-destructive text-destructive-foreground";
      } else if (slotDate > today) {
        computedStatus = "upcoming";
        statusColor = "bg-muted text-muted-foreground";
      } else if (currentTotalMinutes >= closeTotalMinutes) {
        computedStatus = "expired";
        statusColor = "bg-destructive text-destructive-foreground";
      } else {
        computedStatus = "upcoming";
        statusColor = "bg-muted text-muted-foreground";
      }

      const capacity = Number(s.capacity ?? 0);
      const occupancy = Number(s.currentOccupancy ?? 0);
      const pct = capacity > 0 ? Math.round((occupancy / capacity) * 100) : 0;
      const barColor =
        pct >= 80 ? "bg-destructive" : pct >= 50 ? "bg-primary" : pct >= 20 ? "bg-info" : "bg-success";

      return {
        ...s,
        computedStatus,
        statusColor,
        pct,
        barColor,
        occ: `${occupancy}/${capacity}`,
        displayStatus: computedStatus === "active"
            ? "● ACTIVE"
            : computedStatus === "upcoming"
              ? "UPCOMING"
              : "CLOSED",
      };
    });
  }, [slots, now]);

  const handleEditSlot = async (slot: Slot) => {
    try {
      const response = await fetchSlotById(slot.id);
      setEditingSlot(response.data);
      setShowAdd(true);
    } catch (error) {
      console.error("Failed to load slot details:", error);
    }
  };

  const handleViewSlotItems = async (slot: Slot) => {
    try {
      const response = await fetchSlotById(slot.id);
      setViewItemsSlot(response.data);
    } catch (error) {
      console.error("Failed to load slot items:", error);
    }
  };

  const handleToggleSlotItem = async (slotId: string, itemId: string) => {
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;

    const disabledItemIds = slot.disabledItemIds ?? [];
    const isCurrentlyDisabled = disabledItemIds.includes(itemId);
    // We want to enable if currently disabled, disable if currently enabled
    const shouldEnable = isCurrentlyDisabled;

    // Optimistic update: apply change locally first
    const newDisabled = isCurrentlyDisabled
      ? disabledItemIds.filter((id) => id !== itemId)
      : [...disabledItemIds, itemId];

    const prevSlots = slots;
    setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, disabledItemIds: newDisabled } : s)));
    if (viewItemsSlot?.id === slotId) {
      setViewItemsSlot({ ...viewItemsSlot, disabledItemIds: newDisabled });
    }

    try {
      await toggleSlotItem(slotId, itemId, shouldEnable);
    } catch (error) {
      // Rollback on error
      console.error("Failed to toggle slot item:", error);
      setSlots(prevSlots);
      if (viewItemsSlot?.id === slotId) {
        const original = prevSlots.find((s) => s.id === slotId) ?? viewItemsSlot;
        setViewItemsSlot(original);
      }
      toast.error((error as Error).message || "Could not toggle this item.");
    }
  };

  const handleDeleteSlot = async (slotId: string, slotName: string) => {
    if (!confirm(`Are you sure you want to delete the "${slotName}" slot?`)) {
      return;
    }

    try {
      await deleteSlot(slotId);
      setSlots((prev) => prev.filter((s) => s.id !== slotId));
      toast.success(`Slot "${slotName}" deleted successfully.`);
    } catch (error) {
      const err = error as Error & { response?: { status?: number } };
      const is409 = err?.response?.status === 409;
      const message = err.message || "Could not delete the slot.";

      if (is409) {
        // Slot has existing orders — offer to close/archive instead
        toast.error(message, {
          duration: 8000,
          action: {
            label: "Close Slot Instead",
            onClick: () => {
              const target = slots.find((s) => s.id === slotId);
              if (target) handleCloseSlot(target);
            },
          },
        });
      } else {
        toast.error(message);
      }
    }
  };

  const handleCloseSlot = async (slot: Slot & { computedStatus?: string }) => {
    const isClosing = slot.active;
    const action = isClosing ? "close" : "reopen";
    const isExpired = slot.computedStatus === "expired";

    const message = isClosing
      ? `Close slot "${slot.name}"?`
      : isExpired
        ? `This slot has expired or is closed. Would you like to forcefully reopen slot "${slot.name}" with its original time schedule?`
        : `Reopen slot "${slot.name}"?`;

    if (!confirm(message)) {
      return;
    }

    try {
      let response;
      if (isClosing) {
        response = await closeSlot(slot.id);
      } else {
        // Force-open preserves the original start/end times; the API re-enables
        // assigned items and moves an already-passed slot to the next orderable date.
        response = await toggleSlotActive(slot.id, true);
      }

      setSlots((prev) => prev.map((s) => (s.id === slot.id ? response.data : s)));
      if (viewItemsSlot?.id === slot.id) {
        setViewItemsSlot(response.data);
      }
      toast.success(`Slot ${isExpired && !isClosing ? "force-opened" : action + "d"} successfully.`);
    } catch (error) {
      console.error(`Failed to ${action} slot:`, error);
      toast.error((error as Error).message || `Could not ${action} slot.`);
    }
  };

  

  const handleSaveSlot = async (data: Partial<Slot>) => {
    const canteenId = data.canteenId || selectedCanteenId || undefined;
    if (!canteenId) {
      toast.error("Please select a canteen before saving the slot.");
      return;
    }

    const promise = editingSlot
      ? updateSlot(editingSlot.id, data, editingSlot, canteenId)
      : createSlot(data, canteenId);

    toast.promise(promise, {
      loading: editingSlot ? "Updating slot..." : "Creating slot...",
      success: (response) => {
        if (editingSlot) {
          setSlots(slots.map((s) => (s.id === editingSlot.id ? response.data : s)));
        } else {
          setSlots([...slots, response.data]);
        }
        setShowAdd(false);
        setEditingSlot(null);
        localStorage.setItem("canteen_selected_id", canteenId);
        setSelectedCanteenId(canteenId);
        return editingSlot ? "Slot updated successfully" : "Slot created successfully";
      },
      error: (err) => {
        console.error("Failed to save slot:", err);
        return err.message || "Failed to save slot";
      },
    });
  };

  return (
    <AdminLayout crumb="Time Slots">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Meal Slot Management</h1>
        {/* <p className="text-xs text-muted-foreground">Configure operational windows and assign menu items per slot.</p> */}
      </div>

      {canShowCanteenSelect && (
        <div className="mb-4 max-w-xs">
          <Label>Canteen</Label>
          <select
            value={selectedCanteenId}
            onChange={(event) => setSelectedCanteenId(event.target.value)}
            disabled={isCanteenLoading || canteens.length === 0}
            className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none"
          >
            {canteens.length === 0 ? (
              <option value="">No canteens available</option>
            ) : (
              canteens.map((canteen) => (
                <option key={canteen.id} value={canteen.id}>
                  {canteen.name}
                </option>
              ))
            )}
          </select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {computedSlots.map((s) => (
          <div key={s.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between">
              <div className="text-[10px] tracking-widest text-muted-foreground">{s.type}</div>
              <span className={`rounded px-2 py-0.5 text-[9px] font-bold ${s.statusColor}`}>{s.displayStatus}</span>
            </div>
            <div className="mt-1 text-xl font-bold">{s.name}</div>
            <div className="text-[11px] text-muted-foreground">{s.displayTime}</div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Occupancy</span>
              <span className="font-semibold text-foreground">
                {s.occ} <span className="text-muted-foreground">({s.pct}%)</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-muted">
              <div className={`h-1.5 rounded-full ${s.barColor}`} style={{ width: `${s.pct}%` }} />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => handleViewSlotItems(s)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="View slot items"
              >
                <Eye className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleEditSlot(s)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Edit slot"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleDeleteSlot(s.id, s.name)}
                className="rounded p-1 text-muted-foreground hover:bg-red-500/20 hover:text-red-500"
                title="Delete slot"
              >
                <Trash2 className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleCloseSlot(s)}
                className={`rounded p-1 transition-colors ${
                  s.active
                    ? "text-muted-foreground hover:bg-red-500/20 hover:text-red-500"
                    : "text-muted-foreground hover:bg-green-500/20 hover:text-green-500"
                }`}
                title={s.active ? "Close slot" : "Reopen slot"}
              >
                {s.active ? (
                  <Ban className="h-3 w-3" />
                ) : (
                  <Power className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={() => {
            setEditingSlot(null);
            setShowAdd(true);
          }}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card/40 p-6 text-center hover:border-primary hover:bg-card/60 transition-colors"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-primary hover:bg-primary hover:text-primary-foreground transition-colors">
            <Plus className="h-5 w-5" />
          </div>
        </button>
      </div>

      {showAdd && (
        <SlotModal
          onClose={() => {
            setShowAdd(false);
            setEditingSlot(null);
          }}
          slot={editingSlot}
          onSave={handleSaveSlot}
          menuItems={menuItems}
          canteens={canteens}
          selectedCanteenId={editingSlot?.canteenId ?? selectedCanteenId}
          onCanteenChange={setSelectedCanteenId}
          isCanteenLoading={isCanteenLoading}
          canShowCanteenSelect={canShowCanteenSelect}
        />
      )}
      {viewItemsSlot && (
        <SlotItemsModal
            slot={viewItemsSlot}
            menuItems={menuItems}
            onClose={() => setViewItemsSlot(null)}
            onToggleItem={handleToggleSlotItem}
          />
      )}
    </AdminLayout>
  );
}

function parseLocalDate(value?: string) {
  const [year, month, day] = String(value ?? "").split("-").map(Number);
  if (!year || !month || !day) {
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }
  return new Date(year, month - 1, day);
}

function SlotModal({
  onClose,
  slot,
  onSave,
  menuItems,
  canteens,
  selectedCanteenId,
  onCanteenChange,
  isCanteenLoading,
  canShowCanteenSelect,
}: {
  onClose: () => void;
  slot: Slot | null;
  onSave: (data: Partial<Slot>) => void;
  menuItems: MenuItem[];
  canteens: ApiCanteen[];
  selectedCanteenId: string;
  onCanteenChange: (canteenId: string) => void;
  isCanteenLoading: boolean;
  canShowCanteenSelect: boolean;
}) {
  const defaultQtyRow = { available: "100", minPerOrder: "1", maxPerOrder: "4" };
  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(slot?.date ?? new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState(slot?.startTime ?? "07:00");
  const [end, setEnd] = useState(slot?.endTime ?? "09:00");
  const [bufferMinutes, setBufferMinutes] = useState(slot?.bufferMinutes ?? 0);
  const [active, setActive] = useState(slot?.active ?? true);
  const [mealType, setMealType] = useState<ItemType>(slot?.type ?? "Meal");
  const [selectedCategories, setSelectedCategories] = useState<ItemCategory[]>(
    slot?.categories ? slot.categories as ItemCategory[] : ["Veg"]
  );
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(slot?.menuItemIds ?? []);
  const [itemQtyById, setItemQtyById] = useState<
    Record<string, { available: string; minPerOrder: string; maxPerOrder: string }>
  >({});
  const [slotName, setSlotName] = useState(slot?.name ?? "");
  const [capacity, setCapacity] = useState(slot?.capacity ?? 100);
  const [canteenId, setCanteenId] = useState(slot?.canteenId ?? selectedCanteenId);

  useEffect(() => {
    if (slot) {
      setDate(slot.date ?? new Date().toISOString().slice(0, 10));
      setStart(slot.startTime ?? "07:00");
      setEnd(slot.endTime ?? "09:00");
      setBufferMinutes(slot.bufferMinutes ?? 0);
      setActive(slot.active ?? true);
      setMealType(slot.type ?? "Meal");
      setSelectedCategories(slot.categories ? slot.categories as ItemCategory[] : ["Veg"]);
      setSelectedItemIds(slot.menuItemIds ?? []);
      const nextQty: Record<string, { available: string; minPerOrder: string; maxPerOrder: string }> = {};
      for (const row of slot.slotMenuItems ?? []) {
        nextQty[row.menuItemId] = {
          available: row.availableQuantity != null ? String(row.availableQuantity) : defaultQtyRow.available,
          minPerOrder: String(row.minOrderQuantity ?? 1),
          maxPerOrder: String(row.maxOrderQuantity ?? row.maxQtyPerOrder ?? 4),
        };
      }
      setItemQtyById(nextQty);
      setSlotName(slot.name);
      setCapacity(slot.capacity ?? 100);
      setCanteenId(slot.canteenId ?? selectedCanteenId);
    } else {
      setDate(new Date().toISOString().slice(0, 10));
      setStart("07:00");
      setEnd("09:00");
      setBufferMinutes(0);
      setActive(true);
      setMealType("Meal");
      setSelectedCategories(["Veg"]);
      setSelectedItemIds([]);
      setItemQtyById({});
      setSlotName("");
      setCapacity(100);
      setCanteenId(selectedCanteenId);
    }
  }, [slot, selectedCanteenId, defaultQtyRow.available]);

  useEffect(() => {
    setCanteenId(slot?.canteenId ?? selectedCanteenId);
  }, [slot?.canteenId, selectedCanteenId]);

  const handleCanteenSelect = (nextCanteenId: string) => {
    setCanteenId(nextCanteenId);
    setSelectedItemIds([]);
    setItemQtyById({});
    onCanteenChange(nextCanteenId);
  };

  const liveItems = useMemo(
    () =>
      menuItems.filter((item) => {
        if (!item.available) return false;
        return true;
      }),
    [menuItems]
  );

  const validCategories = useMemo(() => {
    const categoriesFromItems = Array.from(
      new Set(liveItems.map((item) => item.category).filter(Boolean))
    ) as ItemCategory[];
    return Array.from(new Set([...categoriesFromItems, ...selectedCategories]));
  }, [liveItems, selectedCategories]);

  useEffect(() => {
    if (selectedCategories.length === 0 && validCategories.length > 0) {
      setSelectedCategories([validCategories[0]]);
    }
  }, [mealType, validCategories, selectedCategories]);

  const filteredItems = useMemo(
    () =>
      liveItems
        .filter((item) => selectedCategories.includes(item.category))
        .sort((a, b) => {
          const aMatchesMeal = a.type === mealType ? 0 : 1;
          const bMatchesMeal = b.type === mealType ? 0 : 1;
          return aMatchesMeal - bMatchesMeal || a.name.localeCompare(b.name);
        }),
    [liveItems, mealType, selectedCategories]
  );

  const orderCloseTimeLabel = useMemo(() => {
    const [startHour, startMinute] = start.split(":").map(Number);
    if (!Number.isFinite(startHour) || !Number.isFinite(startMinute)) return "";
    return formatMinutesAsTime(startHour * 60 + startMinute - Number(bufferMinutes || 0));
  }, [bufferMinutes, start]);

  const visibleSelectedItemIds = useMemo(() => {
    const visibleItemIds = new Set(filteredItems.map((item) => item.id));
    return selectedItemIds.filter((itemId) => visibleItemIds.has(itemId));
  }, [filteredItems, selectedItemIds]);

  const updateQtyField = (itemId: string, key: "available" | "minPerOrder" | "maxPerOrder", value: string) => {
    setItemQtyById((prev) => {
      const current = prev[itemId] ?? defaultQtyRow;
      return {
        ...prev,
        [itemId]: {
          ...current,
          [key]: value,
        },
      };
    });
  };

  const handleSave = () => {
    if (!slotName.trim()) {
      toast.error("Please enter a slot name");
      return;
    }

    if (!canteenId) {
      toast.error("Please select a canteen");
      return;
    }

    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);
    const startTotalMinutes = startHour * 60 + startMinute;
    const endTotalMinutes = endHour * 60 + endMinute;
    const slotDurationMinutes = endTotalMinutes - startTotalMinutes;
    const normalizedBufferMinutes = Number(bufferMinutes || 0);

    if (!Number.isFinite(normalizedBufferMinutes) || normalizedBufferMinutes < 0) {
      toast.error("Buffer time must be 0 or more minutes.");
      return;
    }

    if (slotDurationMinutes <= 0) {
      toast.error("End time must be after start time.");
      return;
    }

    if (normalizedBufferMinutes > startTotalMinutes) {
      toast.error("Buffer time cannot be earlier than the start of the day.");
      return;
    }

    const menuItemsWrite: SlotMenuItemWrite[] = [];
    for (const id of selectedItemIds) {
      const row = itemQtyById[id] ?? defaultQtyRow;
      const portions = parseInt((row.available || defaultQtyRow.available).trim(), 10);
      const min_order_quantity = parseInt(row.minPerOrder.trim(), 10);
      const max_qty_per_order = parseInt(row.maxPerOrder.trim(), 10);

      if (!Number.isFinite(portions) || portions < 1) {
        toast.error("Portions (slot) must be a positive number for all selected items.");
        return;
      }

      if (!Number.isFinite(min_order_quantity) || min_order_quantity < 1 || min_order_quantity > 99) {
        toast.error("Min / person must be between 1 and 99.");
        return;
      }

      if (!Number.isFinite(max_qty_per_order) || max_qty_per_order < 1 || max_qty_per_order > 99) {
        toast.error("Max / person must be between 1 and 99.");
        return;
      }

      if (max_qty_per_order < min_order_quantity) {
        toast.error("Max / person must be greater than or equal to Min / person.");
        return;
      }

      if (min_order_quantity > portions) {
        toast.error("Min / person cannot be greater than Portions (slot).");
        return;
      }

      menuItemsWrite.push({
        menu_item_id: id,
        available_quantity: portions,
        min_order_quantity,
        max_order_quantity: max_qty_per_order,
        max_qty_per_order,
      });
    }

    onSave({
      name: slotName.trim(),
      date,
      startTime: start,
      endTime: end,
      bufferMinutes: normalizedBufferMinutes,
      displayTime: `${start} — ${end}`,
      active,
      type: mealType,
      categories: selectedCategories,
      menuItemIds: selectedItemIds,
      menuItemsWrite,
      capacity,
      canteenId,
    });
  };

  const toggleItem = (itemId: string) => {
    setSelectedItemIds((cur) => {
      if (cur.includes(itemId)) {
        setItemQtyById((q) => {
          const { [itemId]: _, ...rest } = q;
          return rest;
        });
        return cur.filter((id) => id !== itemId);
      }
      setItemQtyById((q) => ({
        ...q,
        [itemId]: q[itemId] ?? defaultQtyRow,
      }));
      return [...cur, itemId];
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6">
        <button onClick={onClose} className="absolute right-3 top-3 text-muted-foreground"><X className="h-4 w-4" /></button>
        <div className="mb-4">
          <div className="text-lg font-bold">{slot ? "Edit Slot" : "Add New Slot"}</div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {canShowCanteenSelect && (
              <div className="col-span-2">
                <Label>Canteen</Label>
                <select
                  value={canteenId}
                  onChange={(event) => handleCanteenSelect(event.target.value)}
                  disabled={Boolean(slot) || isCanteenLoading || canteens.length === 0}
                  className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">Select canteen</option>
                  {canteens.map((canteen) => (
                    <option key={canteen.id} value={canteen.id}>
                      {canteen.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-span-2">
              <Label>Slot Name</Label>
              <input
                placeholder="e.g., Breakfast"
                value={slotName}
                onChange={(e) => setSlotName(e.target.value.replace(/[^a-zA-Z0-9 ]/g, ""))}
                className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <div className="relative">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none [color-scheme:dark]"
                />
              </div>
            </div>
            <div>
              <Label>Capacity</Label>
              <input
                type="number"
                min="1"
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Time</Label>
              <label className="relative block cursor-pointer" onClick={() => startInputRef.current?.showPicker?.()}>
                <input
                  ref={startInputRef}
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none"
                />
              </label>
            </div>
            <div>
              <Label>End Time</Label>
              <label className="relative block cursor-pointer" onClick={() => endInputRef.current?.showPicker?.()}>
                <input
                  ref={endInputRef}
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none"
                />
              </label>
            </div>
          </div>

          <div>
            <Label>Buffer Time (minutes)</Label>
            <input
              type="number"
              min="0"
              step="1"
              value={bufferMinutes}
              onChange={(e) => setBufferMinutes(Math.max(0, Number(e.target.value || 0)))}
              className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none"
            />
            <div className="mt-1 text-[10px] text-muted-foreground">
              Ordering closes at {orderCloseTimeLabel || "end time"}.
            </div>
          </div>

          <div>
            <Label>Meal Type</Label>
            <div className="flex gap-3">
              {(["Breakfast", "Meal"] as const).map((t) => (
                <label key={t} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${mealType === t ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`}>
                  <input
                    type="radio"
                    name="mealType"
                    value={t}
                    checked={mealType === t}
                    onChange={() => { 
                      setMealType(t); 
                      setSelectedItemIds([]); 
                      setItemQtyById({});
                      setSelectedCategories(["Veg"]);
                    }}
                    className="accent-primary"
                  />
                  <span className="font-semibold">{t}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label>Categories</Label>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 rounded-md border border-border bg-input/20 p-2">
                {validCategories.map((c) => {
                  const isSelected = selectedCategories.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setSelectedCategories((prev) =>
                          prev.includes(c)
                            ? prev.filter((cat) => cat !== c)
                            : [...prev, c]
                        );
                      }}
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold transition ${
                        isSelected
                          ? "bg-primary text-white shadow-sm"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">Select one or more categories.</div>
          </div>

          <div>
            <Label>
              Assign Menu Items{" "}
              <span className="ml-1 text-muted-foreground">({filteredItems.length} matching)</span>
            </Label>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-input/20 p-2">
              {filteredItems.length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No items match the selected category.
                </div>
              )}
              {filteredItems.map((it) => {
                const checked = selectedItemIds.includes(it.id);
                const qtyRow = itemQtyById[it.id] ?? defaultQtyRow;
                return (
                  <div
                    key={it.id}
                    className={`rounded-md border text-left text-sm transition ${
                      checked ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleItem(it.id)}
                      className="flex w-full items-center justify-between px-3 py-2"
                    >
                      <div>
                        <div className="text-xs font-semibold">{it.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {it.category} · {it.type} · {formatINR(it.price)}
                        </div>
                      </div>
                      <div
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                          checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </div>
                    </button>
                    {checked && (
                      <div className="grid grid-cols-2 gap-2 border-t border-border/80 bg-input/25 px-3 py-2">
                        <div>
                          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Portions (slot total)
                          </div>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            placeholder="e.g. 100"
                            value={qtyRow.available}
                            onChange={(e) => updateQtyField(it.id, "available", e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded border border-border bg-input/40 px-2 py-1 text-xs outline-none"
                          />
                        </div>
                        <div>
                          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Min / person
                          </div>
                          <input
                            type="number"
                            min={1}
                            max={99}
                            step={1}
                            value={qtyRow.minPerOrder}
                            onChange={(e) => updateQtyField(it.id, "minPerOrder", e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded border border-border bg-input/40 px-2 py-1 text-xs outline-none"
                          />
                        </div>
                        <div>
                          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Max / person
                          </div>
                          <input
                            type="number"
                            min={1}
                            max={99}
                            step={1}
                            value={qtyRow.maxPerOrder}
                            onChange={(e) => updateQtyField(it.id, "maxPerOrder", e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded border border-border bg-input/40 px-2 py-1 text-xs outline-none"
                          />
                        </div>
                        <p className="col-span-2 text-[10px] text-muted-foreground">
                          Portions is total stock for this item in this slot. Min / person and Max / person are per-employee order limits.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {visibleSelectedItemIds.length > 0 && (
              <div className="mt-2 text-[11px] text-primary">{visibleSelectedItemIds.length} item(s) selected</div>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-xs text-muted-foreground">Cancel</button>
          <button 
            onClick={handleSave} 
            disabled={!slotName.trim()}
            className="rounded-md bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {slot ? "Update Slot" : "Create Slot"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SlotItemsModal({
  slot,
  menuItems,
  onClose,
  onToggleItem,
}: {
  slot: Slot;
  menuItems: MenuItem[];
  onClose: () => void;
  onToggleItem: (slotId: string, itemId: string) => void;
}) {
  const itemEntries = (slot.menuItemIds ?? []).map((itemId) => {
    const item = menuItems.find((it) => it.id === itemId);
    return item
      ? {
          id: item.id,
          name: item.name,
          category: item.category,
          type: item.type,
          price: item.price,
        }
      : null;
  }).filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6">
        <button onClick={onClose} className="absolute right-3 top-3 text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4">
          <div className="text-lg font-bold">Slot Item Availability</div>
        </div>

        {itemEntries.length === 0 ? (
          <div className="rounded-2xl bg-slate-100/90 p-5 text-center text-sm text-muted-foreground dark:bg-slate-900/90">
            No items have been assigned to this slot yet.
          </div>
        ) : (
          <div className="space-y-3">
            {itemEntries.map((item) => {
              const isDisabled = (slot.disabledItemIds ?? []).includes(item.id);
              return (
                <div key={item.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
                  <div>
                    <div className="text-sm font-semibold">{item.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {item.category} · {item.type} · {formatINR(item.price)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleItem(slot.id, item.id)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                      isDisabled ? "bg-border" : "bg-orange-500"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                        isDisabled ? "translate-x-0.5" : "translate-x-5"
                      }`}
                    />
                  </button>
                  
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">{children}</div>;
}
