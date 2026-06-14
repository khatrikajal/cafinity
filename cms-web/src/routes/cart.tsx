import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Minus, Plus, ShoppingBag, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { checkoutEmployeeOrder, fetchEmployeeMenu } from "@/api/employeeOrders";
import { AppLayout } from "@/components/AppLayout";
import {
  formatINR,
  minCartLineQuantity,
  maxCartLineQuantity,
  removeFromCart,
  updateCartQuantity,
  useCart,
  useEntities,
  type MenuItem,
  type Slot,
} from "@/lib/store/index";

export const Route = createFileRoute("/cart")({
  component: CartPage,
});

function CartPage() {
  const navigate = useNavigate();
  const cart = useCart();
  const storedMenuItems = useEntities<MenuItem>("menuItems");
  const storedMealSlots = useEntities<Slot>("slots");
  const [remoteMenuItems, setRemoteMenuItems] = useState<MenuItem[] | null>(null);
  const [remoteMealSlots, setRemoteMealSlots] = useState<Slot[] | null>(null);
  const [checkingOutSlotId, setCheckingOutSlotId] = useState<string | null>(null);
  const menuItems = remoteMenuItems ?? storedMenuItems;
  const mealSlots = remoteMealSlots ?? storedMealSlots;

  useEffect(() => {
    let ignore = false;
    fetchEmployeeMenu()
      .then((data) => {
        if (ignore) return;
        setRemoteMenuItems(data.items);
        setRemoteMealSlots(data.slots);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  const cartDetails = cart.items.map((item) => {
    const menuItem = menuItems.find((menu) => menu.id === item.menuItemId) ?? null;
    const slot = mealSlots.find((candidate) => candidate.id === item.slotId) ?? null;
    const quantity = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1;
    const resolvedPrice = Number.isFinite(Number(item.price))
      ? Number(item.price)
      : Number.isFinite(Number(menuItem?.price))
        ? Number(menuItem?.price)
        : 0;

    return {
      ...item,
      quantity,
      price: resolvedPrice,
      menuItem,
      slotId: item.slotId ?? "unslotted",
      slotName: slot?.name ?? "General",
      slotClosed: slot?.status === "expired" || slot?.isOrderingOpen === false,
    };
  });

  const groupedItems = cartDetails.reduce<Record<string, typeof cartDetails>>((acc, item) => {
    if (!acc[item.slotId]) {
      acc[item.slotId] = [];
    }
    acc[item.slotId].push(item);
    return acc;
  }, {});

  const slotGroups = Object.entries(groupedItems);
  const subtotal = cartDetails.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handleCheckoutSlot = async (slotId: string, slotName: string) => {
    const itemsForSlot = groupedItems[slotId] ?? [];
    if (itemsForSlot.length === 0) return;

    if (itemsForSlot.some((item) => item.slotClosed)) {
      toast.error("This slot is closed for ordering.");
      return;
    }

    try {
      setCheckingOutSlotId(slotId);
      const order = await checkoutEmployeeOrder({
        slotId,
        items: itemsForSlot.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
        })),
      });

      itemsForSlot.forEach((item) => removeFromCart(item.menuItemId, item.slotId));
      toast.success(`Order placed for ${slotName}`, {
        description: order.orderNumber,
      });
      navigate({ to: "/orders" });
    } catch (error) {
      toast.error((error as Error).message || "Could not place order.");
    } finally {
      setCheckingOutSlotId(null);
    }
  };

  return (
    <AppLayout title="Cart">
      <div className="mx-auto max-w-5xl space-y-6">
        <button
          onClick={() => navigate({ to: "/menu" })}
          className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" />
          Continue ordering
        </button>

        {cart.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card py-16 text-center">
            <UtensilsCrossed className="h-12 w-12 text-muted-foreground opacity-50" />
            <h2 className="mt-4 text-lg font-semibold">Your cart is empty</h2>
            <p className="mt-2 text-sm text-muted-foreground">Add a few meals from the menu to place an order.</p>
            <button
              onClick={() => navigate({ to: "/menu" })}
              className="mt-6 rounded-xl bg-primary px-6 py-2.5 font-semibold text-white transition-colors hover:bg-primary/90"
            >
              Browse Menu
            </button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[1fr_340px]">
            <div className="space-y-6">
              <div className="flex items-center justify-between rounded-2xl border bg-card p-6">
                <h1 className="flex items-center gap-2 text-xl font-bold">
                  Cart
                  <span className="text-sm font-normal text-muted-foreground">({cart.items.length} items)</span>
                </h1>
                <button
                  onClick={() => cart.items.forEach((item) => removeFromCart(item.menuItemId, item.slotId))}
                  className="flex items-center gap-2 text-sm font-medium text-destructive transition-colors hover:text-destructive/80"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear cart
                </button>
              </div>

              {slotGroups.map(([slotId, items]) => {
                const slotName = items[0]?.slotName ?? "General";
                const slotTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

                return (
                  <div key={slotId} className="overflow-hidden rounded-2xl border bg-card">
                    <div className="flex items-center justify-between border-b px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <ShoppingBag className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="font-bold">{slotName}</h2>
                          <p className="text-xs text-muted-foreground">Checkout separately for this slot</p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-primary">{formatINR(slotTotal)}</span>
                    </div>

                    <div className="space-y-4 p-6">
                      {items.map((item) => (
                        <div key={`${item.slotId}:${item.menuItemId}`} className="flex items-center justify-between gap-4 rounded-xl border bg-muted/20 p-4">
                          <div className="flex items-center gap-4">
                            <div className="h-16 w-16 overflow-hidden rounded-xl border bg-card">
                              {item.image ? (
                                <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No image</div>
                              )}
                            </div>
                            <div>
                              <h3 className="font-semibold">{item.name}</h3>
                              <p className="text-sm text-muted-foreground">{formatINR(item.price)} each</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 rounded-full border bg-card px-2 py-1">
                              <button
                                onClick={() => {
                                  const nextQuantity = item.quantity - 1;
                                  const min = minCartLineQuantity(item.menuItem, item.slotId);
                                  if (nextQuantity < min) {
                                    if (min === 1 && nextQuantity <= 0) {
                                      removeFromCart(item.menuItemId, item.slotId);
                                      return;
                                    }
                                    toast.message(`Minimum ${min} of this dish per order for this slot.`);
                                    return;
                                  }
                                  if (nextQuantity <= 0) {
                                    removeFromCart(item.menuItemId, item.slotId);
                                  } else {
                                    updateCartQuantity(item.menuItemId, nextQuantity, item.slotId);
                                  }
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="w-4 text-center text-sm font-semibold">{item.quantity}</span>
                              <button
                                onClick={() => {
                                  const cap = maxCartLineQuantity(item.menuItem, item.slotId);
                                  const min = minCartLineQuantity(item.menuItem, item.slotId);
                                  if (item.quantity >= cap) {
                                    toast.message(`Maximum ${cap} of this dish per order for this slot.`);
                                    return;
                                  }
                                  if (item.quantity < min) {
                                    updateCartQuantity(item.menuItemId, min, item.slotId);
                                    return;
                                  }
                                  updateCartQuantity(item.menuItemId, item.quantity + 1, item.slotId);
                                }}
                                disabled={
                                  item.menuItem
                                    ? item.quantity >= maxCartLineQuantity(item.menuItem, item.slotId)
                                    : false
                                }
                                className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>

                            <div className="min-w-[90px] text-right">
                              <div className="font-bold">{formatINR(item.price * item.quantity)}</div>
                              <div className="text-[10px] text-muted-foreground">
                                Min {minCartLineQuantity(item.menuItem, item.slotId)} · Max {maxCartLineQuantity(item.menuItem, item.slotId)}
                              </div>
                              <button
                                onClick={() => removeFromCart(item.menuItemId, item.slotId)}
                                className="mt-1 text-xs font-medium text-destructive hover:underline"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="sticky top-24 h-fit rounded-2xl border bg-card p-6">
              <div className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatINR(subtotal)}</span>
                </div>
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold">Total</span>
                    <span className="text-lg font-bold">{formatINR(subtotal)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-8 space-y-3">
                {slotGroups.map(([slotId, items]) => {
                  const slotName = items[0]?.slotName ?? "General";
                  const slotTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
                  const slotClosed = items.some((item) => item.slotClosed);

                  return (
                    <button
                      key={`checkout-${slotId}`}
                      onClick={() => handleCheckoutSlot(slotId, slotName)}
                      disabled={slotClosed || checkingOutSlotId === slotId}
                      className={`w-full rounded-xl py-3.5 font-bold text-white transition-all ${
                        !slotClosed && checkingOutSlotId !== slotId
                          ? "bg-primary shadow-lg shadow-primary/25 hover:bg-primary/90 hover:shadow-primary/40 active:scale-[0.98]"
                          : "cursor-not-allowed bg-muted text-muted-foreground"
                      }`}
                    >
                      {slotClosed
                        ? `${slotName} closed`
                        : checkingOutSlotId === slotId
                          ? "Placing order..."
                          : `Checkout ${slotName} - ${formatINR(slotTotal)}`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
