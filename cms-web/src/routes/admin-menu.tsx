// Cafinity rebrand — logo + favicon update
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { Download, Plus, Pencil, X, UploadCloud, Trash2, Layers3, Send } from "lucide-react";
import { AdminLayout } from "./admin-orders";
import { formatINR, type Slot, type SlotMenuItemWrite } from "@/lib/store";
import { useCategories, useMenuItems } from "@/hooks/useMenu";
import type { ApiCategory, ApiMenuItem, CreateMenuItemPayload } from "@/api/menu";
import { fetchSlotById, fetchSlots, updateSlot } from "@/api/slotapi";
import { deleteMenuMaster, listMenuMasters, type MenuMaster, upsertMenuMaster } from "@/lib/menuMasters";
import { toast } from "sonner";

export const Route = createFileRoute("/admin-menu")({ component: AdminMenu });

type ItemType = "Breakfast" | "Meal";

function AdminMenu() {
  const {
    canteenId,
    categories,
    isLoading: isCategoryLoading,
    error: categoryError,
    createCategory,
    removeCategory,
    refetch: refetchCategories,
  } = useCategories();
  const { items, isLoading, error, createItem, updateItem, removeItem, bulkImport } = useMenuItems();
  const [tab, setTab] = useState("All");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ApiMenuItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showMasterForm, setShowMasterForm] = useState(false);
  const [editingMaster, setEditingMaster] = useState<MenuMaster | null>(null);
  const [menuMasters, setMenuMasters] = useState<MenuMaster[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isApplyingMasterId, setIsApplyingMasterId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const bulkFileRef = useRef<HTMLInputElement>(null);
  const ITEMS_PER_PAGE = 10;

  const tabs = useMemo(
    () => ["All", ...categories.map((c) => c.name)],
    [categories],
  );

  const visible = useMemo(() => {
    let list = items;
    if (tab !== "All") list = list.filter((i) => i.category_name === tab);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, tab, query]);

  const totalPages = Math.ceil(visible.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedItems = visible.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [tab, query]);

  useEffect(() => {
    setMenuMasters(listMenuMasters());
  }, []);

  useEffect(() => {
    fetchSlots()
      .then((response) => setSlots(response.data ?? []))
      .catch(() => setSlots([]));
  }, []);

  const openAdd = () => {
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (item: ApiMenuItem) => {
    setEditing(item);
    setShowForm(true);
  };

  const openAddMaster = () => {
    setEditingMaster(null);
    setShowMasterForm(true);
  };

  const openEditMaster = (master: MenuMaster) => {
    setEditingMaster(master);
    setShowMasterForm(true);
  };

  const refreshMenuMasters = () => setMenuMasters(listMenuMasters());

  const applyMenuMasterToSlots = async (master: MenuMaster) => {
    if (!canteenId) {
      toast.error("No canteen selected for applying this menu master.");
      return;
    }
    if (master.itemIds.length === 0) {
      toast.error("Add at least one menu item to this menu master.");
      return;
    }
    if (master.slotIds.length === 0) {
      toast.error("Select at least one slot for this menu master.");
      return;
    }

    setIsApplyingMasterId(master.id);
    try {
      for (const slotId of master.slotIds) {
        const response = await fetchSlotById(slotId);
        const slot = response.data;
        const existingByItemId = new Map(
          (slot.slotMenuItems ?? []).map((row) => [
            row.menuItemId,
            {
              menu_item_id: row.menuItemId,
              available_quantity: row.availableQuantity ?? 100,
              min_order_quantity: row.minOrderQuantity ?? 1,
              max_order_quantity: row.maxOrderQuantity ?? row.maxQtyPerOrder ?? 4,
              max_qty_per_order: row.maxQtyPerOrder ?? row.maxOrderQuantity ?? 4,
            } satisfies SlotMenuItemWrite,
          ]),
        );

        for (const itemId of master.itemIds) {
          if (!existingByItemId.has(itemId)) {
            existingByItemId.set(itemId, {
              menu_item_id: itemId,
              available_quantity: 100,
              min_order_quantity: 1,
              max_order_quantity: 4,
              max_qty_per_order: 4,
            });
          }
        }

        await updateSlot(
          slot.id,
          {
            menuItemIds: Array.from(existingByItemId.keys()),
            menuItemsWrite: Array.from(existingByItemId.values()),
          },
          slot,
          canteenId,
        );
      }

      toast.success(`Menu master "${master.name}" applied to ${master.slotIds.length} slot(s).`);
    } catch (error) {
      toast.error((error as Error).message || "Failed to apply menu master to slots.");
    } finally {
      setIsApplyingMasterId(null);
    }
  };

  const remove = async (item: ApiMenuItem) => {
    if (confirm(`Delete "${item.name}"?`)) {
      await removeItem(item.id);
    }
  };

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please select a CSV file.");
      return;
    }
    await bulkImport(file);
    refetchCategories();
    if (bulkFileRef.current) bulkFileRef.current.value = "";
  };

  const downloadSampleCsv = () => {
    const csv = [
      "name,base_price,category,item_type,description,display_tag,is_available",
      "Masala Dosa,60,Veg,BREAKFAST,Crispy dosa with potato masala,POPULAR,true",
      "Chicken Thali,180,Non-veg,MEAL,Complete meal with chicken curry,,true",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "menu-items-sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout crumb="Menu & Items">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Menu & Items Management</h1>
          {/* <p className="text-xs text-muted-foreground">Configure your daily canteen offerings.</p> */}
          {!canteenId && (
            <p className="mt-1 text-xs font-medium text-destructive">
              No canteen is selected. Category and item actions need an available canteen.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={bulkFileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => importCsv(event.target.files?.[0])}
          />
          <button
            onClick={downloadSampleCsv}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Download className="h-3 w-3" /> Sample CSV
          </button>
          <button
            onClick={() => bulkFileRef.current?.click()}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <UploadCloud className="h-3 w-3" /> Bulk Import
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-3 w-3" /> Add New Item
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Layers3 className="h-4 w-4 text-primary" />
              Menu Masters
            </h2>
            {/* <p className="text-xs text-muted-foreground">
              Build reusable menu bundles from existing items and apply them to multiple slots in one action.
            </p> */}
          </div>
          <button
            onClick={openAddMaster}
            className="flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-3 w-3" /> Add Menu Master
          </button>
        </div>

        {menuMasters.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-input/20 p-6 text-center text-sm text-muted-foreground">
            No menu masters yet. Create one from existing menu items, then apply it to selected slots.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {menuMasters.map((master) => {
              const selectedItems = items.filter((item) => master.itemIds.includes(item.id));
              const selectedSlots = slots.filter((slot) => master.slotIds.includes(slot.id));

              return (
                <div key={master.id} className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold">{master.name}</h3>
                      {/* <p className="mt-1 text-xs text-muted-foreground">
                        {master.description?.trim() ||no descripti}
                      </p> */}
                    </div>
                    <div className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary">
                      {selectedItems.length} items
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {selectedItems.slice(0, 5).map((item) => (
                      <span key={item.id} className="rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                        {item.name}
                      </span>
                    ))}
                    {selectedItems.length > 5 && (
                      <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                        +{selectedItems.length - 5} more
                      </span>
                    )}
                  </div>

                  <div className="mt-3 text-[11px] text-muted-foreground">
                    Slots: {selectedSlots.length > 0 ? selectedSlots.map((slot) => slot.name).join(", ") : "None selected"}
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      onClick={() => openEditMaster(master)}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (!confirm(`Delete menu master "${master.name}"?`)) return;
                        deleteMenuMaster(master.id);
                        refreshMenuMasters();
                      }}
                      className="rounded-md border border-destructive/20 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => applyMenuMasterToSlots(master)}
                      disabled={isApplyingMasterId === master.id}
                      className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" />
                      {isApplyingMasterId === master.id ? "Applying..." : "Apply to Slots"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md border border-border bg-card p-1 text-xs">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-4 py-1.5 transition ${
                tab === t
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search menu..."
          className="w-56 rounded-md border border-border bg-input/40 px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div>
        {categoryError && (
          <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {categoryError}
          </div>
        )}
        {isLoading && (
          <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            Loading menu items...
          </div>
        )}
        {error && !isLoading && (
          <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-destructive">
            {error}
          </div>
        )}

        {!isLoading && !error && paginatedItems.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {paginatedItems.map((it) => {
              const itemName = it.name || "Item";
              const itemCategory = it.category_name || "Unknown";
              const availabilityClass = it.is_available
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-border bg-muted text-muted-foreground";

              return (
                <article
                  key={it.id}
                  className="group overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="relative h-36 overflow-hidden bg-muted/60">
                    <MenuItemImage src={it.photo_url} alt={it.name} />
                    <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                      {it.display_tag && (
                        <span className="rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">
                          {it.display_tag}
                        </span>
                      )}
                      <span className="rounded bg-background/90 px-1.5 py-0.5 text-[9px] font-bold uppercase text-foreground shadow-sm">
                        {it.item_type}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2.5 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold">{itemName}</h3>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <span>{itemCategory}</span>
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${availabilityClass}`}
                          >
                            {it.is_available ? "Available" : "Unavailable"}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-base font-extrabold text-primary">
                        {formatINR(Number(it.base_price))}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-1 border-t border-border/70 pt-2">
                      <button
                        onClick={() => openEdit(it)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => remove(it)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!isLoading && !error && paginatedItems.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No items match this filter.
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(endIndex, visible.length)} of {visible.length}{" "}
              items
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>

              <div className="flex gap-1">
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`rounded-md px-3 py-1 text-xs ${
                        currentPage === pageNum
                          ? "bg-primary text-primary-foreground"
                          : "border border-border hover:bg-muted"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {showForm && (
        <ItemFormModal
          initial={editing}
          categories={categories}
          categoryError={categoryError}
          isCategoryLoading={isCategoryLoading}
          createCategory={createCategory}
          removeCategory={removeCategory}
          createItem={createItem}
          updateItem={updateItem}
          onClose={() => setShowForm(false)}
        />
      )}
      {showMasterForm && (
        <MenuMasterModal
          initial={editingMaster}
          items={items}
          slots={slots}
          onClose={() => {
            setShowMasterForm(false);
            setEditingMaster(null);
          }}
          onSave={async (payload) => {
            const saved = upsertMenuMaster(payload);
            refreshMenuMasters();
            setShowMasterForm(false);
            setEditingMaster(null);

            if (saved) {
              toast.success(`Menu master "${saved.name}" saved.`);
              if (saved.slotIds.length > 0 && saved.itemIds.length > 0) {
                await applyMenuMasterToSlots(saved);
              }
            }
          }}
        />
      )}
    </AdminLayout>
  );
}

function MenuItemImage({ src, alt }: { src: string | null; alt: string }) {
  const [hasError, setHasError] = useState(false);
  const imageUrl = src ? resolveMenuImageUrl(src) : "";

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!imageUrl || hasError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/40 px-4 text-center text-xs font-medium text-muted-foreground transition-transform duration-500 group-hover:scale-105">
        No image uploaded
      </div>
    );
  }

  return (
    <>
      <img
        src={imageUrl}
        alt={alt}
        onError={() => setHasError(true)}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-black/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
    </>
  );
}

function resolveMenuImageUrl(value: string) {
  const raw = value.trim();
  if (!raw) return "";

  if (raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("/media/")) {
    return raw;
  }

  if (typeof window !== "undefined") {
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin === window.location.origin && url.pathname.startsWith("/media/")) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
      return url.toString();
    } catch {
      return raw;
    }
  }

  return raw;
}

function ItemFormModal({
  initial,
  categories,
  categoryError,
  isCategoryLoading,
  createCategory,
  removeCategory,
  createItem,
  updateItem,
  onClose,
}: {
  initial: ApiMenuItem | null;
  categories: ApiCategory[];
  categoryError: string | null;
  isCategoryLoading: boolean;
  createCategory: (name: string) => Promise<ApiCategory | null>;
  removeCategory: (id: string) => Promise<void>;
  createItem: (payload: CreateMenuItemPayload) => Promise<ApiMenuItem | null>;
  updateItem: (id: string, payload: Partial<CreateMenuItemPayload>) => Promise<ApiMenuItem | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState<string>(initial ? String(initial.base_price) : "");
  const [categoryId, setCategoryId] = useState<string>(initial?.category?.id ?? "");
  const [type, setType] = useState<ItemType>(
    initial?.item_type === "BREAKFAST" ? "Breakfast" : "Meal",
  );
  const [imagePreview, setImagePreview] = useState<string | undefined>(initial?.photo_url ?? undefined);
  const [imageFile, setImageFile] = useState<File | undefined>();
  const [tag, setTag] = useState<string>(initial?.display_tag ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  const alphaSpaceOnly = (value: string) => value.replace(/[^A-Za-z ]+/g, "");
  const isAlphaSpace = (value: string) => /^[A-Za-z ]+$/.test(value);
  const descriptionTextOnly = (value: string) => value.replace(/[^A-Za-z .,]+/g, "");
  const isDescriptionText = (value: string) => /^[A-Za-z .,]+$/.test(value);

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be <= 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
    setImageFile(file);
  };

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const trimmedTag = tag.trim();
    const isEdit = Boolean(initial);

    if (!trimmedName) return toast.error("Item name is required");
    if (!isAlphaSpace(trimmedName)) return toast.error("Item name can only contain letters and spaces");
    if (trimmedDescription && !isDescriptionText(trimmedDescription)) return toast.error("Description can only contain letters, spaces, periods, and commas");
    if (trimmedTag && !isAlphaSpace(trimmedTag)) return toast.error("Display tag can only contain letters and spaces");

    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) return toast.error("Enter a valid price");
    if (!categoryId) return toast.error("Select or create a category");

    const payload: CreateMenuItemPayload = {
      name: trimmedName,
      description: isEdit ? trimmedDescription : trimmedDescription || undefined,
      base_price: priceNum,
      category_id: categoryId,
      item_type: type === "Breakfast" ? "BREAKFAST" : "MEAL",
      is_available: initial?.is_available ?? true,
      display_tag: isEdit ? trimmedTag : trimmedTag || undefined,
      photo: imageFile,
    };

    const saved = initial ? await updateItem(initial.id, payload) : await createItem(payload);
    if (saved) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-6">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4">
          <div className="text-lg font-bold">{initial ? "Edit Item" : "Add New Item"}</div>
          <div className="text-xs text-muted-foreground">Description and image are optional.</div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Item Name *">
            <input
              value={name}
              onChange={(e) => setName(alphaSpaceOnly(e.target.value))}
              placeholder="e.g. Premium Veg Thali"
              className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

          <Field label="Price (INR) *">
            <input
              value={price}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d*\.?\d*$/.test(v)) setPrice(v);
              }}
              inputMode="decimal"
              placeholder="180"
              className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

          <Field label="Category *">
            <CategorySelect
              value={categoryId}
              categories={categories}
              error={categoryError}
              isLoading={isCategoryLoading}
              onChange={setCategoryId}
              onCreate={createCategory}
              onRemove={removeCategory}
            />
          </Field>

          <Field label="Item Type *">
            <div className="flex gap-1 rounded-md border border-border p-1">
              {(["Breakfast", "Meal"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex-1 rounded py-1.5 text-xs font-semibold transition ${
                    type === t
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Display Tag (optional)">
            <input
              value={tag}
              onChange={(e) => setTag(alphaSpaceOnly(e.target.value))}
              placeholder="e.g. POPULAR"
              className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Dish Description (recommended)">
              <textarea
                value={description}
                onChange={(e) => setDescription(descriptionTextOnly(e.target.value))}
                rows={2}
                placeholder="Add dish details for users (ingredients, spice level, serving notes)"
                className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Item Image (optional)">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => onPickFile(e.target.files?.[0])}
                className="hidden"
              />
              {imagePreview ? (
                <div className="flex items-center gap-3 rounded-md border border-border bg-input/20 p-2">
                  <img src={imagePreview} alt="preview" className="h-16 w-16 rounded-md object-cover" />
                  <div className="flex-1 text-xs text-muted-foreground">Image selected</div>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="rounded-md border border-border px-2 py-1 text-xs"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImagePreview(undefined);
                      setImageFile(undefined);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex h-[88px] w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-input/20 text-center hover:bg-input/40"
                >
                  <UploadCloud className="mb-1 h-5 w-5 text-primary" />
                  <div className="text-xs text-primary">Click to upload</div>
                  <div className="text-[10px] text-muted-foreground">PNG, JPG up to 5MB</div>
                </button>
              )}
            </Field>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded-md bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            {initial ? "Save Changes" : "Create Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategorySelect({
  value,
  categories,
  error,
  isLoading,
  onChange,
  onCreate,
  onRemove,
}: {
  value: string;
  categories: ApiCategory[];
  error: string | null;
  isLoading: boolean;
  onChange: (v: string) => void;
  onCreate: (name: string) => Promise<ApiCategory | null>;
  onRemove: (id: string) => Promise<void>;
}) {
  const selectedName = categories.find((c) => c.id === value)?.name ?? "";
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(selectedName);
  const [pendingAction, setPendingAction] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(selectedName);
  }, [selectedName]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setInputValue(selectedName);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [selectedName]);

  const isTyping = isOpen && inputValue !== selectedName;
  const filtered = isTyping
    ? categories.filter((c) => c.name.toLowerCase().includes(inputValue.toLowerCase()))
    : categories;
  const exactMatch = categories.some(
    (c) => c.name.toLowerCase() === inputValue.trim().toLowerCase(),
  );
  const showAdd = inputValue.trim().length > 0 && !exactMatch;

  return (
    <div className="relative" ref={containerRef}>
      <input
        className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary"
        value={inputValue}
        onChange={(e) => {
          const raw = e.target.value;
          const sanitized = raw.replace(/[^A-Za-z ]+/g, "");
          setInputValue(sanitized);
          setLocalError(sanitized === raw ? null : "Only letters and spaces are allowed.");
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="Search or add category..."
      />
      {(localError || error) && (
        <p className="mt-1 text-xs font-medium text-destructive">{localError || error}</p>
      )}

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card p-1 shadow-md">
          {isLoading && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading categories...</div>
          )}
          {filtered.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-sm hover:bg-muted"
            >
              <button
                type="button"
                className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  onChange(c.id);
                  setInputValue(c.name);
                  setIsOpen(false);
                }}
              >
                {c.name}
              </button>
              <button
                type="button"
                className="mr-1 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Delete ${c.name}`}
                disabled={pendingAction}
                onClick={async (event) => {
                  event.stopPropagation();
                  const ok = confirm(
                    `Warning: Delete category "${c.name}"?\n\nThis category will be removed from the dropdown. Existing menu items may still keep their old category reference.`,
                  );
                  if (!ok) return;
                  setPendingAction(true);
                  setLocalError(null);
                  try {
                    await onRemove(c.id);
                    if (value === c.id) {
                      onChange("");
                      setInputValue("");
                    }
                  } catch (err) {
                    setLocalError(err instanceof Error ? err.message : "Unable to delete category.");
                  } finally {
                    setPendingAction(false);
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {showAdd && (
            <button
              type="button"
              disabled={pendingAction}
              className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-primary hover:bg-muted"
              onClick={async () => {
                const trimmedValue = inputValue.trim();
                if (!trimmedValue) {
                  setLocalError("Category name is required.");
                  return;
                }
                if (!/^[A-Za-z ]+$/.test(trimmedValue)) {
                  setLocalError("Category name can only contain letters and spaces.");
                  return;
                }
                setPendingAction(true);
                setLocalError(null);
                try {
                  const created = await onCreate(trimmedValue);
                  if (!created) {
                    setLocalError("Category was not created. Check the message above and try again.");
                    return;
                  }
                  onChange(created.id);
                  setInputValue(created.name);
                  setIsOpen(false);
                } catch (err) {
                  setLocalError(err instanceof Error ? err.message : "Unable to create category.");
                } finally {
                  setPendingAction(false);
                }
              }}
            >
              + Add new category "{inputValue.trim()}"
            </button>
          )}
          {filtered.length === 0 && !showAdd && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No categories found.</div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function MenuMasterModal({
  initial,
  items,
  slots,
  onClose,
  onSave,
}: {
  initial: MenuMaster | null;
  items: ApiMenuItem[];
  slots: Slot[];
  onClose: () => void;
  onSave: (payload: Omit<MenuMaster, "createdAt" | "updatedAt"> & { id?: string }) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [itemIds, setItemIds] = useState<string[]>(initial?.itemIds ?? []);
  const [slotIds, setSlotIds] = useState<string[]>(initial?.slotIds ?? []);
  const [search, setSearch] = useState("");

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category_name.toLowerCase().includes(q),
    );
  }, [items, search]);

  const toggleItem = (itemId: string) => {
    setItemIds((current) => (current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]));
  };

  const toggleSlot = (slotId: string) => {
    setSlotIds((current) => (current.includes(slotId) ? current.filter((id) => id !== slotId) : [...current, slotId]));
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Menu master name is required.");
      return;
    }
    if (itemIds.length === 0) {
      toast.error("Select at least one menu item.");
      return;
    }

    await onSave({
      id: initial?.id,
      name: name.trim(),
      description: description.trim(),
      itemIds,
      slotIds,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
      <div className="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card p-6">
        <button onClick={onClose} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4">
          <div className="text-lg font-bold">{initial ? "Edit Menu Master" : "Add Menu Master"}</div>
          <div className="text-xs text-muted-foreground">
            Pick existing menu items once, then push them into multiple slot assignments.
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Field label="Master Name *">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Breakfast Combo A"
                className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>

            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional note for this reusable menu master"
                className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>

            <Field label="Search Menu Items">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type item name, category, or description..."
                className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>

            <Field label={`Select Menu Items (${itemIds.length} selected)`}>
              <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-border bg-input/20 p-2">
                {visibleItems.map((item) => {
                  const checked = itemIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleItem(item.id)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                        checked ? "bg-primary/10 text-foreground" : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{item.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {item.category_name} · {item.item_type} · {formatINR(Number(item.base_price))}
                        </div>
                      </div>
                      <div className={`ml-3 h-4 w-4 rounded border ${checked ? "border-primary bg-primary" : "border-border"}`} />
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>

          <div className="space-y-4">
            <Field label={`Select Slots (${slotIds.length} selected)`}>
              <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-border bg-input/20 p-2">
                {slots.map((slot) => {
                  const checked = slotIds.includes(slot.id);
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => toggleSlot(slot.id)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                        checked ? "bg-primary/10 text-foreground" : "hover:bg-muted/50"
                      }`}
                    >
                      <div>
                        <div className="font-semibold">{slot.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {slot.displayTime ?? `${slot.startTime} - ${slot.endTime}`}
                        </div>
                      </div>
                      <div className={`ml-3 h-4 w-4 rounded border ${checked ? "border-primary bg-primary" : "border-border"}`} />
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="rounded-md border border-border bg-input/20 p-3 text-xs text-muted-foreground">
              Saving a menu master keeps the item bundle for reuse. If slots are selected, the selected items will also be pushed into those slot assignments right away.
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button onClick={submit} className="rounded-md bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90">
            {initial ? "Save Master" : "Create Master"}
          </button>
        </div>
      </div>
    </div>
  );
}
