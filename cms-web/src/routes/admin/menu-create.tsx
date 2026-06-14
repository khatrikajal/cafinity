import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import api from "@/api/client";
import { AppLayout } from "@/components/AppLayout";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/menu-create")({ component: AdminMenuNew });

export default function AdminMenuNew() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [discountedPrice, setDiscountedPrice] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = Number(price) || 0;
    const d = Number(discountedPrice);
    if (!name.trim()) return toast.error("Name is required");
    if (p <= 0) return toast.error("Price must be greater than 0");
    if (discountedPrice !== "" && (!Number.isFinite(d) || d < 0 || d > p)) return toast.error("Discounted price must be >= 0 and <= base price");

    setSaving(true);
    try {
      await api.post("/cms/menu-items/", {
        name,
        price: p,
        discounted_price: discountedPrice === "" ? null : d,
        description,
      });
      toast.success("Menu item created");
      navigate({ to: "/admin/menu" });
    } catch (err) {
      toast.error("Could not create menu item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout title="Create Menu Item">
      <form onSubmit={handleSubmit} className="max-w-xl">
        <div className="mb-4">
          <label className="block text-sm font-medium">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
        </div>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Price</label>
            <input type="number" value={price as any} onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">Discounted Price</label>
            <input type="number" value={discountedPrice as any} onChange={(e) => setDiscountedPrice(e.target.value === "" ? "" : Number(e.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="rounded-xl bg-primary px-4 py-2 text-white">
            {saving ? "Saving..." : "Create"}
          </button>
          <button type="button" onClick={() => navigate({ to: "/admin" })} className="rounded-xl border px-4 py-2">
            Cancel
          </button>
        </div>
      </form>
    </AppLayout>
  );
}
