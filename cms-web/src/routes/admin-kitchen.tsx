import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Building2, Edit3, KeyRound, Plus, Power, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createCanteen,
  createCompany,
  createDeviceUser,
  deleteCanteen,
  deleteCompany,
  fetchCanteens,
  fetchCompanies,
  fetchDeviceUsers,
  resetDeviceUserPin,
  setDeviceUserActive,
  updateCanteen,
  updateCompany,
  updateDeviceUser,
  type CanteenOption,
  type CompanyOption,
  type DeviceUser,
} from "@/api/admin";
import { AdminLayout } from "./admin-orders";
import { TablePanel } from "@/components/TablePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/admin-kitchen")({ component: AdminKitchenUsers });

type DeviceRole = "KITCHEN" | "COUNTER";

type DeviceUserForm = {
  username: string;
  pin: string;
  canteenId: string;
  companyId: string;
};

type CompanyForm = {
  name: string;
  code: string;
};

type CanteenForm = {
  name: string;
  companyId: string;
};

const EMPTY_DEVICE_FORM: DeviceUserForm = {
  username: "",
  pin: "",
  canteenId: "",
  companyId: "",
};

const EMPTY_COMPANY_FORM: CompanyForm = {
  name: "",
  code: "",
};

const EMPTY_CANTEEN_FORM: CanteenForm = {
  name: "",
  companyId: "",
};

const MAX_KITCHEN_INPUT_LENGTH = 100;

function extractError(error: unknown): string {
  if (error && typeof error === "object") {
    const maybeError = error as { response?: { data?: { detail?: string } }; message?: string };
    if (maybeError.response?.data?.detail) return maybeError.response.data.detail;
    if (maybeError.message) return maybeError.message;
  }
  return "Request failed.";
}

function AdminKitchenUsers() {
  const [users, setUsers] = useState<DeviceUser[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [canteens, setCanteens] = useState<CanteenOption[]>([]);
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | DeviceRole>("ALL");

  const [deviceForm, setDeviceForm] = useState<DeviceUserForm>(EMPTY_DEVICE_FORM);
  const [savingDevice, setSavingDevice] = useState(false);
  const [editingUser, setEditingUser] = useState<DeviceUser | null>(null);
  const [resetPinValue, setResetPinValue] = useState("");

  const [companyForm, setCompanyForm] = useState<CompanyForm>(EMPTY_COMPANY_FORM);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [savingCompany, setSavingCompany] = useState(false);

  const [canteenForm, setCanteenForm] = useState<CanteenForm>(EMPTY_CANTEEN_FORM);
  const [editingCanteenId, setEditingCanteenId] = useState<string | null>(null);
  const [savingCanteen, setSavingCanteen] = useState(false);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [deviceResults, companyResults, canteenResults] = await Promise.all([
        fetchDeviceUsers(),
        fetchCompanies(),
        fetchCanteens(),
      ]);
      setUsers(deviceResults);
      setCompanies(companyResults);
      setCanteens(canteenResults);
    } catch (error) {
      toast.error(extractError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const canteenById = useMemo(() => {
    const mapping = new Map<string, CanteenOption>();
    canteens.forEach((canteen) => mapping.set(canteen.id, canteen));
    return mapping;
  }, [canteens]);

  const canteensForSelectedCompany = useMemo(
    () => canteens.filter((canteen) => canteen.company_id === deviceForm.companyId),
    [canteens, deviceForm.companyId],
  );

  const filteredUsers = useMemo(() => {
    const loweredQuery = query.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "ALL" && user.role !== roleFilter) return false;
      if (!loweredQuery) return true;
      return (
        user.username.toLowerCase().includes(loweredQuery) ||
        user.display_name.toLowerCase().includes(loweredQuery)
      );
    });
  }, [users, query, roleFilter]);

  const validatePin = (pin: string) => /^\d{4,6}$/.test(pin.trim());

  const resetDeviceForm = () => {
    setDeviceForm(EMPTY_DEVICE_FORM);
    setEditingUser(null);
    setResetPinValue("");
  };

  const submitDeviceUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!deviceForm.username.trim() || !deviceForm.companyId || !deviceForm.canteenId) {
      toast.error("Company, canteen and username are required.");
      return;
    }

    // Validate username is alphanumeric only (should already be filtered, but double-check)
    const trimmedUsername = deviceForm.username.trim();
    if (!/^[a-zA-Z0-9]+$/.test(trimmedUsername)) {
      toast.error("Kitchen username must contain only letters and numbers.");
      return;
    }
    if (trimmedUsername.length > MAX_KITCHEN_INPUT_LENGTH) {
      toast.error(`Kitchen username cannot exceed ${MAX_KITCHEN_INPUT_LENGTH} characters.`);
      return;
    }

    if (!editingUser && !validatePin(deviceForm.pin)) {
      toast.error("PIN must be 4 to 6 digits.");
      return;
    }

    setSavingDevice(true);
    try {
      if (editingUser) {
        await updateDeviceUser(editingUser.id, {
          username: deviceForm.username.trim(),
          display_name: deviceForm.username.trim(),
          role: editingUser.role,
          company_id: deviceForm.companyId,
          canteen_id: deviceForm.canteenId,
        });
        toast.success("Device user updated.");
      } else {
        await createDeviceUser({
          username: deviceForm.username.trim(),
          display_name: deviceForm.username.trim(),
          role: "KITCHEN",
          pin: deviceForm.pin.trim(),
          company_id: deviceForm.companyId,
          canteen_id: deviceForm.canteenId,
        });
        toast.success("Device user created.");
      }

      resetDeviceForm();
      await loadAllData();
    } catch (error) {
      toast.error(extractError(error));
    } finally {
      setSavingDevice(false);
    }
  };

  const startEditUser = (user: DeviceUser) => {
    setEditingUser(user);
    setDeviceForm({
      username: user.username,
      pin: "",
      companyId: user.company_id,
      canteenId: user.canteen_id,
    });
    setResetPinValue("");
  };

  const handleToggleUserActive = async (user: DeviceUser) => {
    const action = user.is_active ? "Deactivate" : "Activate";
    if (!confirm(`${action} ${user.username}?`)) return;
    try {
      await setDeviceUserActive(user.id, !user.is_active);
      toast.success(`Device user ${user.is_active ? "deactivated" : "activated"}.`);
      await loadAllData();
    } catch (error) {
      toast.error(extractError(error));
    }
  };

  const handleResetPin = async (user: DeviceUser) => {
    if (!validatePin(resetPinValue)) {
      toast.error("Reset PIN must be 4 to 6 digits.");
      return;
    }

    try {
      await resetDeviceUserPin(user.id, resetPinValue.trim());
      toast.success("PIN reset successful.");
      setResetPinValue("");
    } catch (error) {
      toast.error(extractError(error));
    }
  };

  const submitCompany = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = companyForm.name.trim();
    const trimmedCode = companyForm.code.trim();

    if (!trimmedName || !trimmedCode) {
      toast.error("Company name and code are required.");
      return;
    }

    if (!/^[a-zA-Z0-9]+$/.test(trimmedName)) {
      toast.error("Company name must contain only letters and numbers.");
      return;
    }
    if (!/^[a-zA-Z0-9]+$/.test(trimmedCode)) {
      toast.error("Company code must contain only letters and numbers.");
      return;
    }
    if (trimmedName.length > MAX_KITCHEN_INPUT_LENGTH) {
      toast.error(`Company name cannot exceed ${MAX_KITCHEN_INPUT_LENGTH} characters.`);
      return;
    }
    if (trimmedCode.length > MAX_KITCHEN_INPUT_LENGTH) {
      toast.error(`Company code cannot exceed ${MAX_KITCHEN_INPUT_LENGTH} characters.`);
      return;
    }

    setSavingCompany(true);
    try {
      if (editingCompanyId) {
        await updateCompany(editingCompanyId, {
          name: companyForm.name.trim(),
          code: companyForm.code.trim().toUpperCase(),
        });
        toast.success("Company updated.");
      } else {
        await createCompany({
          name: companyForm.name.trim(),
          code: companyForm.code.trim().toUpperCase(),
        });
        toast.success("Company created.");
      }

      setCompanyForm(EMPTY_COMPANY_FORM);
      setEditingCompanyId(null);
      await loadAllData();
    } catch (error) {
      toast.error(extractError(error));
    } finally {
      setSavingCompany(false);
    }
  };

  const startEditCompany = (company: CompanyOption) => {
    setEditingCompanyId(company.id);
    setCompanyForm({
      name: company.name,
      code: company.code,
    });
  };

  const handleDeleteCompany = async (company: CompanyOption) => {
    if (!confirm(`Delete company ${company.name}?`)) return;
    try {
      await deleteCompany(company.id);
      toast.success("Company deleted.");
      if (deviceForm.companyId === company.id) {
        setDeviceForm((previous) => ({ ...previous, companyId: "", canteenId: "" }));
      }
      await loadAllData();
    } catch (error) {
      toast.error(extractError(error));
    }
  };

  const submitCanteen = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = canteenForm.name.trim();
    if (!trimmedName || !canteenForm.companyId) {
      toast.error("Canteen name and company are required.");
      return;
    }
    if (!/^[a-zA-Z0-9]+$/.test(trimmedName)) {
      toast.error("Canteen name must contain only letters and numbers.");
      return;
    }
    if (trimmedName.length > MAX_KITCHEN_INPUT_LENGTH) {
      toast.error(`Canteen name cannot exceed ${MAX_KITCHEN_INPUT_LENGTH} characters.`);
      return;
    }

    setSavingCanteen(true);
    try {
      if (editingCanteenId) {
        await updateCanteen(editingCanteenId, {
          name: canteenForm.name.trim(),
          company_id: canteenForm.companyId,
        });
        toast.success("Canteen updated.");
      } else {
        await createCanteen({
          name: canteenForm.name.trim(),
          company_id: canteenForm.companyId,
        });
        toast.success("Canteen created.");
      }

      setCanteenForm(EMPTY_CANTEEN_FORM);
      setEditingCanteenId(null);
      await loadAllData();
    } catch (error) {
      toast.error(extractError(error));
    } finally {
      setSavingCanteen(false);
    }
  };

  const startEditCanteen = (canteen: CanteenOption) => {
    setEditingCanteenId(canteen.id);
    setCanteenForm({
      name: canteen.name,
      companyId: canteen.company_id,
    });
  };

  const handleDeleteCanteen = async (canteen: CanteenOption) => {
    if (!confirm(`Delete canteen ${canteen.name}?`)) return;
    try {
      await deleteCanteen(canteen.id);
      toast.success("Canteen deleted.");
      if (deviceForm.canteenId === canteen.id) {
        setDeviceForm((previous) => ({ ...previous, canteenId: "" }));
      }
      await loadAllData();
    } catch (error) {
      toast.error(extractError(error));
    }
  };

  return (
    <AdminLayout crumb="Kitchen Users">
      <div className="space-y-6">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Company Management</h1>
          </div>
          <form onSubmit={submitCompany} className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Input
              value={companyForm.name}
              maxLength={MAX_KITCHEN_INPUT_LENGTH}
              onChange={(event) => {
                const raw = event.target.value;
                const filtered = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, MAX_KITCHEN_INPUT_LENGTH);
                setCompanyForm((previous) => ({ ...previous, name: filtered }));
              }}
              placeholder="Company Name (alphanumeric only)"
            />
            <Input
              value={companyForm.code}
              maxLength={MAX_KITCHEN_INPUT_LENGTH}
              onChange={(event) => {
                const raw = event.target.value;
                const filtered = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, MAX_KITCHEN_INPUT_LENGTH);
                setCompanyForm((previous) => ({ ...previous, code: filtered }));
              }}
              placeholder="Company Code (alphanumeric only)"
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={savingCompany}>
                {editingCompanyId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                {savingCompany ? "Saving..." : editingCompanyId ? "Update" : "Add"}
              </Button>
              {editingCompanyId && (
                <Button type="button" variant="outline" onClick={() => { setEditingCompanyId(null); setCompanyForm(EMPTY_COMPANY_FORM); }}>
                  Cancel
                </Button>
              )}
            </div>
          </form>

          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    No companies found.
                  </TableCell>
                </TableRow>
              ) : (
                companies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell>{company.name}</TableCell>
                    <TableCell>{company.code}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => startEditCompany(company)}>
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => handleDeleteCompany(company)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Canteen Management</h1>
          </div>
          <form onSubmit={submitCanteen} className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Input
              value={canteenForm.name}
              maxLength={MAX_KITCHEN_INPUT_LENGTH}
              onChange={(event) => {
                const raw = event.target.value;
                const filtered = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, MAX_KITCHEN_INPUT_LENGTH);
                setCanteenForm((previous) => ({ ...previous, name: filtered }));
              }}
              placeholder="Canteen Name (alphanumeric only)"
            />
            <select
              value={canteenForm.companyId}
              onChange={(event) => setCanteenForm((previous) => ({ ...previous, companyId: event.target.value }))}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select Company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button type="submit" disabled={savingCanteen}>
                {editingCanteenId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                {savingCanteen ? "Saving..." : editingCanteenId ? "Update" : "Add"}
              </Button>
              {editingCanteenId && (
                <Button type="button" variant="outline" onClick={() => { setEditingCanteenId(null); setCanteenForm(EMPTY_CANTEEN_FORM); }}>
                  Cancel
                </Button>
              )}
            </div>
          </form>

          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {canteens.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    No canteens found.
                  </TableCell>
                </TableRow>
              ) : (
                canteens.map((canteen) => (
                  <TableRow key={canteen.id}>
                    <TableCell>{canteen.name}</TableCell>
                    <TableCell>{canteen.company_name}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => startEditCanteen(canteen)}>
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => handleDeleteCanteen(canteen)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Kitchen/Counter Login Credentials</h1>
          </div>

          <form onSubmit={submitDeviceUser} className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <select
              value={deviceForm.companyId}
              onChange={(event) => {
                const companyId = event.target.value;
                setDeviceForm((previous) => ({ ...previous, companyId, canteenId: "" }));
              }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select Company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <select
              value={deviceForm.canteenId}
              onChange={(event) => setDeviceForm((previous) => ({ ...previous, canteenId: event.target.value }))}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              disabled={!deviceForm.companyId}
            >
              <option value="">Select Canteen</option>
              {canteensForSelectedCompany.map((canteen) => (
                <option key={canteen.id} value={canteen.id}>
                  {canteen.name}
                </option>
              ))}
            </select>
            <Input
              value={deviceForm.username}
              maxLength={MAX_KITCHEN_INPUT_LENGTH}
              onChange={(event) => {
                const raw = event.target.value;
                const filtered = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, MAX_KITCHEN_INPUT_LENGTH);
                setDeviceForm((previous) => ({ ...previous, username: filtered }));
              }}
              placeholder="Username (alphanumeric only, max 100 chars)"
            />
            {!editingUser && (
              <Input
                value={deviceForm.pin}
                onChange={(event) => setDeviceForm((previous) => ({ ...previous, pin: event.target.value }))}
                placeholder="PIN (4-6 digits)"
                maxLength={6}
              />
            )}

            <div className="flex gap-2 lg:col-span-3">
              <Button type="submit" disabled={savingDevice}>
                {editingUser ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                {savingDevice ? "Saving..." : editingUser ? "Update User" : "Create User"}
              </Button>
              {editingUser && (
                <Button type="button" variant="outline" onClick={resetDeviceForm}>
                  Cancel Edit
                </Button>
              )}
              <Button type="button" variant="outline" onClick={loadAllData}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </form>

          {editingUser && (
            <div className="mt-5 rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-3 text-sm font-semibold">Reset PIN for {editingUser.username}</h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                  value={resetPinValue}
                  onChange={(event) => setResetPinValue(event.target.value)}
                  placeholder="New PIN (4-6 digits)"
                  maxLength={6}
                  className="sm:max-w-xs"
                />
                <Button type="button" onClick={() => handleResetPin(editingUser)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Reset PIN
                </Button>
              </div>
            </div>
          )}
        </div>

        <TablePanel title="Kitchen/Counter Users" description={`${filteredUsers.length} users`}>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by username or display name"
              className="md:max-w-sm"
            />
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as "ALL" | DeviceRole)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm md:w-44"
            >
              <option value="ALL">All Roles</option>
              <option value="KITCHEN">Kitchen</option>
              <option value="COUNTER">Counter</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Canteen</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No kitchen/counter users found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell>{user.display_name}</TableCell>
                    <TableCell>{user.role}</TableCell>
                    <TableCell>{user.is_active ? "ACTIVE" : "INACTIVE"}</TableCell>
                    <TableCell>{canteenById.get(user.canteen_id)?.name ?? user.canteen_id}</TableCell>
                    <TableCell>{canteenById.get(user.canteen_id)?.company_name ?? user.company_id}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => startEditUser(user)}>
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          title={user.is_active ? "Deactivate user" : "Activate user"}
                          onClick={() => handleToggleUserActive(user)}
                        >
                          <Power className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
        </TablePanel>

      </div>
    </AdminLayout>
  );
}
