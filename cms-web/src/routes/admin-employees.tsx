import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Download, Eye, FileUp, Plus, Upload, Users } from "lucide-react";
import { toast } from "sonner";

import { AdminLayout } from "./admin-orders";
import { DataTableToolbar } from "@/components/DataTableToolbar";
import { Pagination } from "@/components/Pagination";
import { TablePanel } from "@/components/TablePanel";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fetchCanteens, type CanteenOption } from "@/api/admin";
import { downloadCSV, downloadCSVTemplate } from "@/lib/store";
import { cn } from "@/lib/utils";
import api from "@/api/client";
import { getCurrentUser } from "@/lib/auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/admin-employees")({ component: AdminEmployees });

const PAGE_SIZE = 10;

type Employee = {
  id: string;
  employeeId: string;
  fullName: string;
  roleType: string;
  canteenId?: string;
  canteenName?: string;
  department: string;
  designation: string;
  email: string;
  phone: string;
  joiningDate: string;
  gender: string;
  address: string;
  createdAt: string;
  temporary_password?: string;
  isActive: boolean;
};

type EmployeeInput = {
  employeeId: string;
  fullName: string;
  roleType: string;
  canteenId: string | null;
  departmentId: string | null;
  newDepartmentName?: string;
  designation: string;
  email: string;
  phone: string;
  joiningDate: string;
  gender: string;
  address: string;
};

type Department = {
  id: string;
  name: string;
};

type DepartmentListResponse = {
  results?: Department[];
};

type EmployeeListResponse = {
  count: number;
  results: Employee[];
};

type BulkCreateFailure = {
  row: number;
  email: string;
  error?: string;
  errors?: Record<string, string[] | string>;
};

type BulkCreateResponse = {
  created?: Employee[];
  count: number;
  failed?: BulkCreateFailure[];
  failed_count?: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMPTY_INPUT: EmployeeInput = {
  employeeId: "",
  fullName: "",
  roleType: "EMPLOYEE",
  canteenId: null,
  departmentId: null,
  newDepartmentName: "",
  designation: "",
  email: "",
  phone: "",
  joiningDate: "",
  gender: "",
  address: "",
};

function formatDateForInput(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  return "";
}

function normalizeEmployeeForm(input: Partial<EmployeeInput>): EmployeeInput {
  return {
    employeeId: input.employeeId ?? "",
    fullName: input.fullName ?? "",
    roleType: input.roleType || "EMPLOYEE",
    canteenId: input.canteenId ?? null,
    departmentId: input.departmentId ?? null,
    newDepartmentName: input.newDepartmentName ?? "",
    designation: input.designation ?? "",
    email: input.email ?? "",
    phone: input.phone ?? "",
    joiningDate: formatDateForInput(input.joiningDate),
    gender: input.gender ?? "",
    address: input.address ?? "",
  };
}

function mapApiEmployeeToForm(
  employee: Record<string, unknown>,
  departments: Department[],
): EmployeeInput {
  const departmentName =
    typeof employee.department === "string"
      ? employee.department
      : typeof (employee.department as { name?: string } | null)?.name === "string"
        ? (employee.department as { name: string }).name
        : "";
  const selectedDepartment = departments.find((dept) => dept.name === departmentName);

  return normalizeEmployeeForm({
    employeeId: String(employee.employeeId ?? employee.employee_code ?? ""),
    fullName: String(employee.fullName ?? employee.full_name ?? ""),
    roleType: String(employee.roleType ?? employee.role_type ?? "EMPLOYEE"),
    canteenId: (employee.canteenId ?? employee.canteen_id ?? null) as string | null,
    departmentId: (employee.departmentId as string | undefined) ?? selectedDepartment?.id ?? null,
    designation: String(employee.designation ?? ""),
    email: String(employee.email ?? ""),
    phone: String(employee.phone ?? ""),
    joiningDate: formatDateForInput(employee.joiningDate ?? employee.joining_date),
    gender: String(employee.gender ?? ""),
    address: String(employee.address ?? ""),
  });
}

const ACCOUNT_ROLE_OPTIONS = [
  { value: "EMPLOYEE", label: "Employee" },
  { value: "LIMITED_ADMIN", label: "Limited Admin" },
] as const;

// ── Validation utility functions ────────────────────────────────────────────

/**
 * Validate full name: max 50 characters, only alphabetical characters and spaces allowed
 */
function validateFullName(fullName: string): { valid: boolean; error?: string } {
  if (!fullName) {
    return { valid: false, error: "Full name is required" };
  }

  const nameTrimmed = fullName.trim();
  
  if (nameTrimmed.length > 50) {
    return { valid: false, error: `Full name cannot exceed 50 characters (got ${nameTrimmed.length})` };
  }

  const alphabeticalPattern = /^[a-zA-Z\s]*$/;
  if (!alphabeticalPattern.test(nameTrimmed)) {
    return { valid: false, error: "Full name can only contain alphabetical characters and spaces" };
  }
  
  return { valid: true };
}

/**
 * Validate designation: max 50 characters, only alphabetical characters and spaces allowed
 */
function validateDesignation(designation: string): { valid: boolean; error?: string } {
  if (!designation) {
    return { valid: false, error: "Designation is required" };
  }

  const desTrimmed = designation.trim();
  
  if (desTrimmed.length > 50) {
    return { valid: false, error: `Designation cannot exceed 50 characters (got ${desTrimmed.length})` };
  }

  const alphabeticalPattern = /^[a-zA-Z\s]*$/;
  if (!alphabeticalPattern.test(desTrimmed)) {
    return { valid: false, error: "Designation can only contain alphabetical characters and spaces" };
  }
  
  return { valid: true };
}

/**
 * Validate phone number: must be exactly 10 digits, no special characters
 */
function validatePhoneNumber(phone: string): { valid: boolean; error?: string } {
  if (!phone) {
    return { valid: false, error: "Phone number is required" };
  }

  const phoneTrimmed = phone.trim();
  
  // Check if it contains only digits (no spaces, hyphens, or special chars)
  if (!/^\d+$/.test(phoneTrimmed)) {
    return { valid: false, error: "Phone number must contain only digits (no spaces, hyphens, or special characters)." };
  }
  
  // Check if it's exactly 10 digits
  if (phoneTrimmed.length !== 10) {
    return { valid: false, error: `Phone number must be exactly 10 digits (got ${phoneTrimmed.length})` };
  }
  
  return { valid: true };
}

/**
 * Validate employee ID: max 10 characters
 */
function validateEmployeeId(employeeId: string): { valid: boolean; error?: string } {
  if (!employeeId) {
    return { valid: false, error: "Employee ID is required" };
  }

  const idTrimmed = employeeId.trim();
  
  if (idTrimmed.length > 10) {
    return { valid: false, error: `Employee ID cannot exceed 10 characters (got ${idTrimmed.length})` };
  }
  
  return { valid: true };
}

// ── API utility functions ────────────────────────────────────────────────────

async function fetchDepartments(): Promise<Department[]> {
  try {
    const response = await api.get<DepartmentListResponse | Department[]>("/auth/departments/");
    return Array.isArray(response.data) ? response.data : response.data.results || [];
  } catch (error) {
    console.error("Failed to fetch departments:", error);
    return [];
  }
}

async function fetchEmployees(page: number, search?: string, department?: string) {
  try {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: PAGE_SIZE.toString(),
    });

    if (search) params.append("search", search);
    if (department) params.append("department", department);

    const response = await api.get<EmployeeListResponse>(`/auth/employees/?${params.toString()}`);
    return response.data;
  } catch (error) {
    console.error("Failed to fetch employees:", error);
    toast.error("Failed to load employees");
    throw error;
  }
}

function resolveEmployeeFullName(response: any, fallback = "") {
  if (typeof response?.fullName === "string" && response.fullName.trim()) {
    return response.fullName.trim();
  }

  const firstName = typeof response?.firstName === "string" ? response.firstName.trim() : "";
  const lastName = typeof response?.lastName === "string" ? response.lastName.trim() : "";
  return `${firstName} ${lastName}`.trim() || fallback;
}

async function createEmployee(data: EmployeeInput): Promise<Employee> {
  let payload: Record<string, unknown> = {};
  try {
    const [firstName, ...lastNameParts] = data.fullName.split(" ");
    const lastName = lastNameParts.join(" ");

    let departmentIdToSend: string | null = null;
    if (data.departmentId) {
      departmentIdToSend = data.departmentId;
    } else if (data.newDepartmentName) {
      const newDept = await createDepartment(data.newDepartmentName.trim());
      departmentIdToSend = newDept.id;
    }

    const validGenders = ["Male", "Female", "Other", ""];
    const genderToSend = validGenders.includes(data.gender) ? data.gender : "";

    payload = {
      employee_code: data.employeeId,
      firstName: firstName,
      lastName: lastName,
      roleType: data.roleType || "EMPLOYEE",
      canteenId: data.canteenId || null,
      departmentId: departmentIdToSend,
      designation: data.designation,
      email: data.email,
      phone: data.phone,
      joiningDate: data.joiningDate,
      gender: genderToSend,
      address: data.address || "",
    };

    const response = await api.post<Employee>("/auth/employees/", payload);
    return response.data;
  } catch (error: any) {
    const errors = error.response?.data || {};
    let errorMsg = "Failed to create employee";
    
    if (errors.detail) {
      errorMsg = errors.detail;
    } else if (Object.keys(errors).length > 0) {
      const fieldLabels: Record<string, string> = {
        employee_code: "Employee Code",
        firstName: "First Name",
        lastName: "Last Name",
        roleType: "Role",
        canteenId: "Canteen",
        email: "Email",
        phone: "Phone",
        departmentId: "Department",
        gender: "Gender",
      };
      const messages = Object.entries(errors)
        .filter(([, value]) => Array.isArray(value) && value.length > 0)
        .map(([field, value]) => `${fieldLabels[field] || field}: ${(value as string[])[0]}`);

      if (messages.length > 0) {
        errorMsg = messages.join(" | ");
      } else {
        errorMsg = JSON.stringify(errors, null, 2);
      }
    }
    
    toast.error(errorMsg);
    throw error;
  }
}

async function bulkCreateEmployees(employees: EmployeeInput[]): Promise<Employee[]> {
  try {
    const validGenders = ["Male", "Female", "Other", ""];

    const departments = await fetchDepartments();
    const departmentCache = new Map<string, string>();

    const resolveDepartmentId = async (departmentInput: string | null): Promise<string | null> => {
      const value = (departmentInput || "").trim();
      if (!value) return null;

      if (UUID_PATTERN.test(value)) {
        return value;
      }

      const lookup = value.toLowerCase();
      if (departmentCache.has(lookup)) {
        return departmentCache.get(lookup) || null;
      }

      const existing = departments.find((dept) => dept.name.trim().toLowerCase() === lookup);
      if (existing) {
        departmentCache.set(lookup, existing.id);
        return existing.id;
      }

      const created = await createDepartment(value);
      departments.push(created);
      departmentCache.set(lookup, created.id);
      return created.id;
    };

    const payloadEmployees = await Promise.all(
      employees.map(async (emp) => {
        const [firstName, ...lastNameParts] = emp.fullName.split(" ");
        const lastName = lastNameParts.join(" ");
        const departmentIdToSend = await resolveDepartmentId(emp.departmentId);
        const genderToSend = validGenders.includes(emp.gender) ? emp.gender : "";

        return {
          employee_code: emp.employeeId,
          firstName: firstName,
          lastName: lastName,
          roleType: emp.roleType || "EMPLOYEE",
          canteenId: emp.canteenId || null,
          departmentId: departmentIdToSend,
          designation: emp.designation,
          email: emp.email,
          phone: emp.phone,
          joiningDate: emp.joiningDate,
          gender: genderToSend,
          address: emp.address || "",
        };
      }),
    );
    
    const payload = {
      employees: payloadEmployees,
    };

    const response = await api.post<BulkCreateResponse>("/auth/employees/bulk-create/", payload);
    const data = response.data;
    
    // Show detailed feedback
    if (data.count > 0) {
      let message = `✅ Created ${data.count} employee${data.count !== 1 ? 's' : ''}`;
      if ((data.failed_count ?? 0) > 0) {
        message += ` | ❌ Failed: ${data.failed_count}`;
      }
      toast.success(message);
    }
    
    if (data.failed && data.failed.length > 0) {
      const failedList = data.failed
        .slice(0, 3)
        .map((f) => `Row ${f.row}: ${f.email}`)
        .join(", ");
      const remaining = data.failed.length > 3 ? ` (+${data.failed.length - 3} more)` : "";
      toast.error(`Failed: ${failedList}${remaining}`);
    }
    
    return data.created || [];
  } catch (error: any) {
    const errorMsg = error.response?.data?.detail || "Failed to bulk create employees";
    toast.error(errorMsg);
    throw error;
  }
}

async function createDepartment(name: string): Promise<Department> {
  try {
    const response = await api.post<Department>("/auth/departments/", { name: name.trim() });
    return response.data;
  } catch (error) {
    console.error("Failed to create department:", error);
    throw error;
  }
}

function getEmployeeErrorMessage(error: unknown, fallback: string) {
  const data = (error as any)?.response?.data;
  if (!data) return (error as Error)?.message || fallback;
  if (typeof data === "string") return data;
  if (typeof data.detail === "string") return data.detail;

  const messages = Object.entries(data)
    .flatMap(([field, value]) => {
      const text = Array.isArray(value) ? value.join(", ") : String(value);
      return text ? [`${field}: ${text}`] : [];
    });

  return messages[0] || fallback;
}

async function updateEmployee(employeeId: string, data: EmployeeInput): Promise<Employee> {
  const [firstName, ...lastNameParts] = data.fullName.split(" ");
  const lastName = lastNameParts.join(" ");

  const payload: any = {
    employee_code: data.employeeId,
    firstName: firstName,
    lastName: lastName,
    roleType: data.roleType || "EMPLOYEE",
    canteenId: data.canteenId || null,
    designation: data.designation,
    email: data.email,
    phone: data.phone,
    joiningDate: data.joiningDate,
    gender: data.gender,
    address: data.address || "",
  };

  if (data.departmentId) {
    payload.departmentId = data.departmentId;
  } else if (data.newDepartmentName) {
    const newDept = await createDepartment(data.newDepartmentName.trim());
    payload.departmentId = newDept.id;
  } else {
    payload.departmentId = null;
  }

  const response = await api.patch<Employee>(`/auth/employees/${employeeId}/`, payload);
  return response.data;
}

async function deactivateEmployee(employeeId: string): Promise<boolean> {
  const response = await api.patch<{ is_active: boolean; message?: string; error?: string }>(
    `/auth/employees/${employeeId}/deactivate/`,
    {},
  );
  return response.data.is_active === false;
}

async function activateEmployee(employeeId: string): Promise<boolean> {
  const response = await api.patch<{ is_active: boolean; message?: string; error?: string }>(
    `/auth/employees/${employeeId}/activate/`,
    {},
  );
  return response.data.is_active === true;
}

function AdminEmployees() {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [canteens, setCanteens] = useState<CanteenOption[]>([]);
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<EmployeeInput>(EMPTY_INPUT);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creatingEmployee, setCreatingEmployee] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isAddingDepartment, setIsAddingDepartment] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [pendingDeactivate, setPendingDeactivate] = useState<Employee | null>(null);
  const [statusLoadingId, setStatusLoadingId] = useState<string | null>(null);
  const currentUser = getCurrentUser();

  // Fetch departments and canteens on mount
  useEffect(() => {
    const loadFormOptions = async () => {
      const [depts, canteenOptions] = await Promise.all([fetchDepartments(), fetchCanteens()]);
      setDepartments(depts);
      setCanteens(canteenOptions || []);
    };
    loadFormOptions();
  }, []);

  useEffect(() => {
    const loadEmployees = async () => {
      try {
        setLoading(true);
        const data = await fetchEmployees(page, query, departmentFilter !== "All" ? departmentFilter : "");
        setEmployees(data.results || []);
        setTotalCount(data.count || 0);
      } catch {
        // Error is handled by fetchEmployees
      } finally {
        setLoading(false);
      }
    };

    loadEmployees();
  }, [page, query, departmentFilter]);

  const departmentOptions = useMemo(() => {
    const uniqueNames = Array.from(
      new Set(
        departments
          .map((dept) => dept.name?.trim())
          .filter((name): name is string => Boolean(name))
      )
    );

    return ["All", ...uniqueNames];
  }, [departments]);

  useEffect(() => {
    setPage(1);
  }, [query, departmentFilter]);

  const resetForm = () => {
    setForm(EMPTY_INPUT);
    setEditingEmployee(null);
    setIsAddingDepartment(false);
    setCurrentStep(1);
  };

  const openEditEmployee = async (employee: Employee) => {
    try {
      const response = await api.get<Record<string, unknown>>(`/auth/employees/${employee.id}/`);
      setForm(mapApiEmployeeToForm(response.data, departments));
      setEditingEmployee(employee);
      setIsAddingDepartment(false);
      setCurrentStep(1);
    } catch {
      toast.error("Failed to load employee details for editing.");
    }
  };

  const cancelEdit = () => {
    resetForm();
  };

  const addEmployee = async (input: EmployeeInput) => {
    if (creatingEmployee) {
      return false;
    }

    const normalized = normalizeEmployeeForm(input);
    const trimmed: EmployeeInput = {
      employeeId: normalized.employeeId.trim(),
      fullName: normalized.fullName.trim(),
      roleType: normalized.roleType || "EMPLOYEE",
      canteenId: normalized.canteenId,
      departmentId: normalized.departmentId,
      newDepartmentName: normalized.newDepartmentName.trim(),
      designation: normalized.designation.trim(),
      email: normalized.email.trim().toLowerCase(),
      phone: normalized.phone.trim(),
      joiningDate: normalized.joiningDate.trim(),
      gender: normalized.gender.trim(),
      address: normalized.address.trim(),
    };

    // Validation
    if (
      !trimmed.employeeId ||
      !trimmed.fullName ||
      !trimmed.designation ||
      !trimmed.email ||
      !trimmed.phone ||
      !trimmed.joiningDate
    ) {
      toast.error("Please fill all required employee fields");
      return false;
    }

    // Validate full name (max 50 characters)
    const fullNameValidation = validateFullName(trimmed.fullName);
    if (!fullNameValidation.valid) {
      toast.error(`Full Name: ${fullNameValidation.error}`);
      return false;
    }

    // Validate designation (max 20 characters)
    const designationValidation = validateDesignation(trimmed.designation);
    if (!designationValidation.valid) {
      toast.error(`Designation: ${designationValidation.error}`);
      return false;
    }

    // Validate employee ID (max 10 characters)
    const empIdValidation = validateEmployeeId(trimmed.employeeId);
    if (!empIdValidation.valid) {
      toast.error(`Employee ID: ${empIdValidation.error}`);
      return false;
    }

    // Validate phone number (10 digits, no special chars)
    const phoneValidation = validatePhoneNumber(trimmed.phone);
    if (!phoneValidation.valid) {
      toast.error(`Phone: ${phoneValidation.error}`);
      return false;
    }

    let toastId: string | number | undefined;

    try {
      setCreatingEmployee(true);
      toastId = toast.loading(editingEmployee ? "Updating employee..." : "Saving employee...", {
        description: `${editingEmployee ? 'Updating' : 'Adding'} ${trimmed.fullName}`,
      });

      let response: Employee;

      if (editingEmployee) {
        response = await updateEmployee(editingEmployee.id, trimmed);
        setEditingEmployee(null); // Close form immediately on success
      } else {
        response = await createEmployee(trimmed);
      }

      toast.dismiss(toastId);
      toastId = undefined;
      // Show brief success notification
      toast.success(editingEmployee ? "Updated ✓" : "Saved ✓", { duration: 2000 });

      if (editingEmployee) {
        // Normalize the API response into the shape our table expects
        const updatedEmployee: Employee = {
          id: (response as any).id ?? editingEmployee.id,
          employeeId: (response as any).employee_code ?? (response as any).employeeId ?? editingEmployee.employeeId,
          fullName: resolveEmployeeFullName(response, editingEmployee.fullName),
          roleType: (response as any).roleType ?? (response as any).role_type ?? editingEmployee.roleType,
          canteenId: (response as any).canteenId ?? (response as any).canteen_id ?? editingEmployee.canteenId,
          canteenName:
            typeof (response as any).canteenName === "string"
              ? (response as any).canteenName
              : (response as any).canteen?.name ?? editingEmployee.canteenName,
          department:
            typeof (response as any).department === "string"
              ? (response as any).department
              : (response as any).department?.name ?? editingEmployee.department,
          designation: (response as any).designation ?? editingEmployee.designation,
          email: (response as any).email ?? editingEmployee.email,
          phone: (response as any).phone ?? editingEmployee.phone,
          joiningDate: (response as any).joiningDate ?? (response as any).joining_date ?? editingEmployee.joiningDate,
          gender: (response as any).gender ?? editingEmployee.gender,
          address: (response as any).address ?? editingEmployee.address,
          createdAt: (response as any).createdAt ?? (response as any).created_at ?? editingEmployee.createdAt,
          temporary_password: (response as any).temporary_password ?? editingEmployee.temporary_password,
          isActive: (response as any).isActive ?? (response as any).is_active ?? editingEmployee.isActive,
        };

        setEmployees((prev) => prev.map((emp) => (emp.id === editingEmployee.id ? updatedEmployee : emp)));
      } else {
        // For new employees, add directly to list without refetching
        const newEmployee: Employee = {
          id: (response as any).id,
          employeeId: (response as any).employee_code ?? (response as any).employeeId,
          fullName: resolveEmployeeFullName(response, trimmed.fullName),
          roleType: (response as any).roleType ?? (response as any).role_type ?? "EMPLOYEE",
          canteenId: (response as any).canteenId ?? (response as any).canteen_id ?? null,
          canteenName: typeof (response as any).canteenName === "string" ? (response as any).canteenName : (response as any).canteen?.name ?? undefined,
          department: typeof (response as any).department === "string" ? (response as any).department : (response as any).department?.name ?? trimmed.newDepartmentName ?? undefined,
          designation: (response as any).designation,
          email: (response as any).email,
          phone: (response as any).phone,
          joiningDate: (response as any).joiningDate ?? (response as any).joining_date,
          gender: (response as any).gender,
          address: (response as any).address,
          createdAt: (response as any).createdAt ?? (response as any).created_at,
          temporary_password: (response as any).temporary_password,
          isActive: (response as any).isActive ?? (response as any).is_active ?? true,
        };
        
        setEmployees((prev) => [newEmployee, ...prev]);
        setTotalCount((prev) => prev + 1);
        
        // Only add new department to state if one was created
        if (trimmed.newDepartmentName && (response as any).department?.id) {
          setDepartments((prev) => [
            ...prev,
            {
              id: (response as any).department.id,
              name: (response as any).department.name ?? trimmed.newDepartmentName,
            },
          ]);
        }
      }
      return true;
    } catch (error) {
      if (toastId !== undefined) {
        toast.dismiss(toastId);
      }
      toast.error(getEmployeeErrorMessage(error, editingEmployee ? "Failed to update employee" : "Failed to create employee"));
      return false;
    } finally {
      setCreatingEmployee(false);
    }
  };

  const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement;
    if (target.tagName === "TEXTAREA") return;
    event.preventDefault();
  };

  const handleSaveClick = async () => {
    const success = await addEmployee(form);
    if (!success) return;
    setForm(EMPTY_INPUT);
    setCurrentStep(1);
  };

  const handleSubmitSingle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleSaveClick();
  };

  const handleExport = () => {
    if (employees.length === 0) {
      toast.error("No employee records to export");
      return;
    }
    downloadCSV(
      employees.map((employee) => ({
        employeeId: employee.employeeId,
        fullName: employee.fullName,
        department: employee.department,
        designation: employee.designation,
        email: employee.email,
        phone: employee.phone,
        joiningDate: employee.joiningDate,
        gender: employee.gender || "NA",
        address: employee.address,
        createdAt: new Date(employee.createdAt).toLocaleString(),
      })),
      "employees",
    );
    toast.success("Employee Excel exported");
  };

  const downloadTemplateCSV = () => {
    const templateData = [
      {
        employeeId: "E001",
        fullName: "John Doe",
        roleType: "EMPLOYEE",
        canteenId: "",
        department: "IT",
        designation: "Senior Developer",
        email: "john.doe@company.com",
        phone: "9876543210",
        joiningDate: "2024-01-15",
        gender: "Male",
        address: "123 Tech Park",
      },
      {
        employeeId: "E002",
        fullName: "Jane Smith",
        roleType: "LIMITED_ADMIN",
        canteenId: "",
        department: "HR",
        designation: "HR Manager",
        email: "jane.smith@company.com",
        phone: "9876543211",
        joiningDate: "2024-02-20",
        gender: "Female",
        address: "456 HR Tower",
      },
    ];
    downloadCSVTemplate(templateData, "employee_template");
    toast.success("Template CSV downloaded");
  };

  const handleBulkFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const text = await file.text();
      const rows = parseCsvRows(text);
      if (rows.length === 0) {
        toast.error("File is empty");
        return;
      }

      const parsed = mapCsvRowsToEmployees(rows);
      if (parsed.length === 0) {
        toast.error("No valid rows found in file");
        return;
      }

      // Validate all rows before upload
      const validationResults = parsed.map((row, idx) => {
        const fullNameValidation = validateFullName(row.fullName);
        const designationValidation = validateDesignation(row.designation);
        const empIdValidation = validateEmployeeId(row.employeeId);
        const phoneValidation = validatePhoneNumber(row.phone);
        
        return {
          index: idx + 2, // +2 because row 1 is header and we're 0-indexed
          employeeId: row.employeeId,
          email: row.email,
          fullNameError: fullNameValidation.error,
          designationError: designationValidation.error,
          empIdError: empIdValidation.error,
          phoneError: phoneValidation.error,
          joiningDateError: row.joiningDate ? undefined : "Joining date must be in YYYY-MM-DD or DD/MM/YYYY format",
          valid:
            fullNameValidation.valid &&
            designationValidation.valid &&
            empIdValidation.valid &&
            phoneValidation.valid &&
            !!row.joiningDate,
        };
      });

      const invalidRows = validationResults.filter((r) => !r.valid);
      const validRows = parsed.filter((_, idx) => validationResults[idx].valid);

      if (invalidRows.length > 0) {
        const errorSummary = invalidRows
          .slice(0, 5)
          .map((r) => {
            const errors = [
              r.fullNameError,
              r.designationError,
              r.empIdError,
              r.phoneError,
              r.joiningDateError,
            ]
              .filter(Boolean)
              .join("; ");
            return `Row ${r.index} (${r.employeeId}): ${errors}`;
          })
          .join("\n");
        
        const remaining = invalidRows.length > 5 ? `\n+${invalidRows.length - 5} more rows with errors` : "";
        
        toast.error(`Validation failed:\n${errorSummary}${remaining}`, {
          description: `${invalidRows.length} row(s) failed validation. Fix the issues and try again.`,
        });

        if (validRows.length === 0) {
          return;
        }
      }

      const existingIds = new Set(employees.map((emp) => emp.employeeId.toLowerCase()));
      const uniqueRows = validRows.filter((row) => !existingIds.has(row.employeeId.toLowerCase()));
      const duplicateCount = validRows.length - uniqueRows.length;

      if (uniqueRows.length === 0) {
        toast.error("All uploaded employee IDs already exist or failed validation");
        return;
      }

      await bulkCreateEmployees(uniqueRows);
      const data = await fetchEmployees(1);
      setEmployees(data.results || []);
      setTotalCount(data.count || 0);
      setPage(1);

      let successMessage = `${uniqueRows.length} employees uploaded`;
      if (duplicateCount > 0) {
        successMessage += ` (${duplicateCount} duplicates skipped)`;
      }
      if (invalidRows.length > 0) {
        successMessage += ` (${invalidRows.length} validation errors)`;
      }
      toast.success(successMessage);
    } catch {
      toast.error("Failed to parse file. Upload CSV format.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const steps = [
    { id: 1 as const, label: "Basic", hint: "ID and name" },
    { id: 2 as const, label: "Work", hint: "Department and role" },
    { id: 3 as const, label: "Contact", hint: "Details and submit" },
  ];
  const selectClassName =
    "h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  const goToNextStep = () => {
    setCurrentStep((step) => (step < 3 ? ((step + 1) as 1 | 2 | 3) : step));
  };

  const goToPreviousStep = () => {
    setCurrentStep((step) => (step > 1 ? ((step - 1) as 1 | 2 | 3) : step));
  };

  return (
    <AdminLayout crumb="Employees">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Employee Admin</h1>
          {/* <p className="mt-1 text-sm text-muted-foreground">
            Add employees one-by-one or bulk upload CSV, then manage them in one shared table layout.
          </p> */}
        </div>
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Card className="rounded-3xl border-border/80 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Plus className="h-4 w-4 text-primary" />
                  {editingEmployee ? "Edit Employee" : "Add Employee"}
                </CardTitle>
                {/* <CardDescription className="mt-1 text-sm">
                  One step at a time. Required: employee ID, full name, designation, email, phone and joining date.
                </CardDescription> */}
              </div>
              <span className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-semibold text-muted-foreground">
                Step {currentStep} of 3
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {steps.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setCurrentStep(step.id)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left transition",
                    currentStep === step.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide">{step.label}</p>
                  <p className="mt-0.5 text-[11px]">{step.hint}</p>
                </button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <form className="space-y-6" onSubmit={handleSubmitSingle} onKeyDown={handleFormKeyDown}>
              {currentStep === 1 && (
                <div className="grid gap-5 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-muted-foreground">Employee ID*</label>
                    <Input
                      value={form.employeeId ?? ""}
                      onChange={(e) => {
                        const limited = e.target.value.slice(0, 10);
                        setForm((current) => ({ ...current, employeeId: limited }));
                      }}
                      maxLength={10}
                      placeholder="Max 10 characters"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-muted-foreground">Full Name*</label>
                    <Input
                      value={form.fullName ?? ""}
                      onChange={(e) => {
                        let value = e.target.value;
                        // Allow only alphabetical characters and spaces
                        value = value.replace(/[^a-zA-Z\s]/g, '');
                        const limited = value.slice(0, 50);
                        setForm((current) => ({ ...current, fullName: limited }));
                      }}
                      maxLength={50}
                      placeholder="Max 50 characters (letters & spaces only)"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-muted-foreground">Role / Access*</label>
                    <select
                      value={form.roleType ?? "EMPLOYEE"}
                      onChange={(event) => setForm((current) => ({ ...current, roleType: event.target.value }))}
                      className={selectClassName}
                    >
                      {ACCOUNT_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {/* <p className="text-[11px] text-muted-foreground">Select Limited Admin for dashboard, counter, guest order, slot, menu and announcement access.</p> */}
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-5">
                  <div className="grid gap-5 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-muted-foreground">Department (Optional)</label>
                      <select
                        value={isAddingDepartment ? "__new__" : form.departmentId || ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === "__new__") {
                            setForm((current) => ({ ...current, departmentId: null, newDepartmentName: "" }));
                            setIsAddingDepartment(true);
                            return;
                          }

                          setForm((current) => ({ ...current, departmentId: value || null, newDepartmentName: "" }));
                          setIsAddingDepartment(false);
                        }}
                        className={selectClassName}
                      >
                        <option value="">-- Select Department --</option>
                        <option value="__new__">+ Add new department</option>
                        {departments.map((dept) => (
                          <option key={dept.id} value={dept.id}>
                            {dept.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-muted-foreground">Canteen (Optional)</label>
                      <select
                        value={form.canteenId || ""}
                        onChange={(event) => setForm((current) => ({ ...current, canteenId: event.target.value || null }))}
                        className={selectClassName}
                      >
                        <option value="">-- Auto (Default Canteen) --</option>
                        {canteens.map((canteen) => (
                          <option key={canteen.id} value={canteen.id}>
                            {canteen.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-muted-foreground">Designation*</label>
                      <Input
                        value={form.designation ?? ""}
                        onChange={(e) => {
                          let value = e.target.value;
                          // Allow only alphabetical characters and spaces
                          value = value.replace(/[^a-zA-Z\s]/g, '');
                          const limited = value.slice(0, 50);
                          setForm((current) => ({ ...current, designation: limited }));
                        }}
                        maxLength={50}
                        placeholder="Max 50 characters (letters & spaces only)"
                      />
                    </div>
                  </div>

                  {isAddingDepartment && (
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-muted-foreground">New Department Name</label>
                      <Input
                        value={form.newDepartmentName || ""}
                        onChange={(e) => {
                          let value = e.target.value;
                          // Allow only alphabetical characters and spaces
                          value = value.replace(/[^a-zA-Z\s]/g, '');
                          setForm((current) => ({ ...current, newDepartmentName: value }));
                        }}
                        placeholder="Alphabetical characters and spaces only"
                      />
                    </div>
                  )}

                  <div className="max-w-sm space-y-1.5">
                    <label className="block text-xs font-semibold text-muted-foreground">Joining Date*</label>
                    <Input
                      value={form.joiningDate ?? ""}
                      onChange={(event) => setForm((current) => ({ ...current, joiningDate: event.target.value }))}
                      type="date"
                    />
                  </div>
                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-muted-foreground">Email*</label>
                      <Input
                        value={form.email ?? ""}
                        onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                        type="email"
                        placeholder="name@company.com"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-muted-foreground">Phone*</label>
                      <Input
                        value={form.phone ?? ""}
                        onChange={(e) => {
                          const onlyDigits = e.target.value.replace(/\D/g, "");
                          setForm((current) => ({ ...current, phone: onlyDigits.slice(0, 10) }));
                        }}
                        type="tel"
                        maxLength={10}
                        inputMode="numeric"
                        placeholder="10 digits only"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-muted-foreground">Gender (Optional)</label>
                      <select
                        value={form.gender ?? ""}
                        onChange={(e) => setForm((current) => ({ ...current, gender: e.target.value }))}
                        className={selectClassName}
                      >
                        <option value="">-- Select Gender --</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-muted-foreground">Address</label>
                    <Textarea
                      value={form.address ?? ""}
                      onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                      rows={3}
                      placeholder="Current address"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={goToPreviousStep} disabled={currentStep === 1}>
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </Button>

                  {currentStep < 3 ? (
                    <Button type="button" onClick={goToNextStep}>
                      Next <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled={creatingEmployee}
                      onClick={handleSaveClick}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {creatingEmployee
                        ? editingEmployee
                          ? "Saving..."
                          : "Adding..."
                        : editingEmployee
                          ? "Update Employee"
                          : "Add Employee"}
                    </Button>
                  )}
                </div>

                {editingEmployee && (
                  <Button type="button" variant="ghost" onClick={cancelEdit}>
                    Cancel Edit
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/80 bg-gradient-to-b from-card to-muted/20 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Upload className="h-4 w-4 text-info" /> Bulk Upload Employees
            </CardTitle>
            {/* <CardDescription>
              Import many employees in one action using a CSV template.
            </CardDescription> */}
          </CardHeader>

          <CardContent className="space-y-4">
            <input
              ref={uploadInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleBulkFile}
              disabled={uploading}
            />

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <Button type="button" onClick={() => uploadInputRef.current?.click()} disabled={uploading} className="justify-center">
                <FileUp className="h-4 w-4" />
                {uploading ? "Uploading..." : "Bulk Upload"}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={downloadTemplateCSV}
                className="justify-center"
                title="Download CSV template with example format"
              >
                <Download className="h-4 w-4 text-primary" /> Template
              </Button>
            </div>

            {/* <div className="rounded-xl border border-border/80 bg-background/60 p-3">
              <p className="text-xs font-semibold text-foreground">How it works</p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>1. Download the template and fill one employee per row.</li>
                <li>2. Keep unique employee IDs and valid emails.</li>
                <li>3. Upload CSV and review success or failed rows.</li>
              </ul>
            </div> */}

            {/* <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
              Tip: duplicate <span className="font-semibold text-foreground">employeeId</span> rows are skipped during import.
            </div> */}
          </CardContent>
        </Card>
      </div>

      <div className="mb-4 rounded-2xl border border-border bg-card p-4">
        <DataTableToolbar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Search by employee id, name, department..."
          extraFilters={
            <>
              <select
                value={departmentFilter}
                onChange={(event) => setDepartmentFilter(event.target.value)}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
              >
                {departmentOptions.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </>
          }
          actions={
            <button
              onClick={handleExport}
              className="flex items-center gap-1 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground"
            >
              <Download className="h-3.5 w-3.5" /> Export Excel
            </button>
          }
        />
      </div>

      <TablePanel
        title="Created Employees"
        description={`${employees.length} employee records on this page`}
        summary={
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground">
            <Users className="mr-1 inline h-3.5 w-3.5" />
            {loading ? "Loading..." : `${totalCount} total`}
          </span>
        }
      >
        {employees.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {loading ? "Loading employees..." : "No employees found."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Canteen</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => (
                <TableRow
                  key={employee.id}
                  className={cn("cursor-pointer", !employee.isActive && "opacity-60 bg-muted/20")}
                  onClick={() => setSelectedEmployee(employee)}
                >
                  <TableCell className="font-semibold text-primary">{employee.employeeId}</TableCell>
                  <TableCell>
                    <div className="font-semibold">{employee.fullName}</div>
                    <div className="text-xs text-muted-foreground">{employee.gender || "NA"}</div>
                    <div className="text-xs text-muted-foreground">{formatRoleType(employee.roleType)}</div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold",
                        employee.isActive
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                          : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400"
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", employee.isActive ? "bg-emerald-500" : "bg-rose-500")} />
                      {employee.isActive ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell>{employee.department || "NA"}</TableCell>
                  <TableCell>{employee.canteenName || "Default (Auto)"}</TableCell>
                  <TableCell>{employee.designation}</TableCell>
                  <TableCell className="max-w-[240px] truncate">{employee.email}</TableCell>
                  <TableCell>{employee.phone}</TableCell>
                  <TableCell>{employee.joiningDate}</TableCell>
                  <TableCell className="space-x-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditEmployee(employee);
                      }}
                      className="rounded-full border border-border bg-background px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={statusLoadingId === employee.id || (employee.isActive && currentUser?.id === employee.id)}
                      onClick={async (event) => {
                        event.stopPropagation();
                        if (employee.isActive) {
                          if (currentUser?.id === employee.id) {
                            toast.error("You cannot deactivate your own account.");
                            return;
                          }
                          setPendingDeactivate(employee);
                          return;
                        }

                        const toastId = toast.loading(`Activating ${employee.fullName}...`);
                        setStatusLoadingId(employee.id);
                        try {
                          await activateEmployee(employee.id);
                          setEmployees((current) =>
                            current.map((emp) => (emp.id === employee.id ? { ...emp, isActive: true } : emp))
                          );
                          toast.success(`Successfully activated ${employee.fullName}`, { id: toastId });
                        } catch (err: unknown) {
                          const message = (err as { response?: { data?: { error?: string; detail?: string } } }).response?.data?.error
                            || (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
                            || "Failed to activate employee";
                          toast.error(message, { id: toastId });
                        } finally {
                          setStatusLoadingId(null);
                        }
                      }}
                      className={cn(
                        "rounded-full border px-2 py-1 text-[11px] font-semibold hover:bg-muted",
                        employee.isActive
                          ? "border-rose-200 bg-rose-50/50 text-rose-600 hover:bg-rose-50"
                          : "border-emerald-200 bg-emerald-50/50 text-emerald-600 hover:bg-emerald-50"
                      )}
                    >
                      {employee.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedEmployee(employee);
                      }}
                      className="rounded-full border border-border bg-background px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted"
                    >
                      <Eye className="mr-1 inline h-3 w-3" />
                      View
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
          totalItems={totalCount}
          pageSize={PAGE_SIZE}
        />
      </TablePanel>

      <Sheet open={!!selectedEmployee} onOpenChange={(open) => !open && setSelectedEmployee(null)}>
        <SheetContent side="right" className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Employee Details</SheetTitle>
            <SheetDescription>
              Full profile details for selected employee.
            </SheetDescription>
          </SheetHeader>

          {selectedEmployee && (
            <div className="mt-6 space-y-4">
              <DetailRow label="Employee ID" value={selectedEmployee.employeeId} />
              <DetailRow label="Full Name" value={selectedEmployee.fullName} />
              <DetailRow label="Status" value={selectedEmployee.isActive ? "Active" : "Inactive"} />
              <DetailRow label="Role" value={formatRoleType(selectedEmployee.roleType)} />
              <DetailRow label="Canteen" value={selectedEmployee.canteenName || "Default (Auto)"} />
              <DetailRow label="Department" value={selectedEmployee.department || "NA"} />
              <DetailRow label="Designation" value={selectedEmployee.designation || "NA"} />
              <DetailRow label="Email" value={selectedEmployee.email || "NA"} />
              <DetailRow label="Phone" value={selectedEmployee.phone || "NA"} />
              <DetailRow label="Joining Date" value={selectedEmployee.joiningDate || "NA"} />
              <DetailRow label="Gender" value={selectedEmployee.gender || "NA"} />
              <DetailRow label="Address" value={selectedEmployee.address || "NA"} />
              <DetailRow
                label="Created"
                value={selectedEmployee.createdAt ? new Date(selectedEmployee.createdAt).toLocaleString() : "NA"}
              />

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    openEditEmployee(selectedEmployee);
                    setSelectedEmployee(null);
                  }}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Edit Employee
                </button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={Boolean(pendingDeactivate)} onOpenChange={(open) => !open && setPendingDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate employee?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate {pendingDeactivate?.fullName}? They will lose access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!pendingDeactivate) return;
                const employee = pendingDeactivate;
                setPendingDeactivate(null);
                const toastId = toast.loading(`Deactivating ${employee.fullName}...`);
                setStatusLoadingId(employee.id);
                try {
                  await deactivateEmployee(employee.id);
                  setEmployees((current) =>
                    current.map((emp) => (emp.id === employee.id ? { ...emp, isActive: false } : emp))
                  );
                  toast.success(`Employee deactivated successfully`, { id: toastId });
                } catch (err: unknown) {
                  const message = (err as { response?: { data?: { error?: string; detail?: string } } }).response?.data?.error
                    || (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
                    || "Failed to deactivate employee";
                  toast.error(message, { id: toastId });
                } finally {
                  setStatusLoadingId(null);
                }
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function formatRoleType(roleType: string) {
  if (roleType === "LIMITED_ADMIN") {
    return "Limited Admin";
  }

  return "Employee";
}

function parseCsvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")));
}

function mapCsvRowsToEmployees(rows: string[][]): EmployeeInput[] {
  if (rows.length === 0) return [];
  
  const [header, ...body] = rows;
  if (body.length === 0) {
    console.warn("CSV has no data rows");
    return [];
  }

  const normalizedHeader = header.map((cell) => normalizeHeader(cell));
  const getIndex = (key: string) => normalizedHeader.indexOf(normalizeHeader(key));

  // Build index map with fallbacks for different column name variations
  const indexMap = {
    employeeId: getIndex("employeeid"),
    fullName: getIndex("fullname"),
    roleType: getIndex("roletype") >= 0 ? getIndex("roletype") : getIndex("role"),
    canteenId: getIndex("canteenid") >= 0 ? getIndex("canteenid") : getIndex("canteen"),
    departmentId: 
      getIndex("departmentid") >= 0 
        ? getIndex("departmentid") 
        : getIndex("department"),
    designation: getIndex("designation"),
    email: getIndex("email"),
    phone: getIndex("phone"),
    joiningDate: getIndex("joiningdate"),
    gender: getIndex("gender"),
    address: getIndex("address"),
  };

  // Check required fields
  const required = [
    { key: "employeeId", index: indexMap.employeeId },
    { key: "fullName", index: indexMap.fullName },
    { key: "designation", index: indexMap.designation },
    { key: "email", index: indexMap.email },
    { key: "phone", index: indexMap.phone },
    { key: "joiningDate", index: indexMap.joiningDate },
  ];

  const missing = required.filter((f) => f.index < 0);
  if (missing.length > 0) {
    console.error("Missing required columns:", missing.map((m) => m.key).join(", "));
    console.error("Found columns:", normalizedHeader);
    return [];
  }

  return body
    .map((row, rowIdx) => {
      try {
        return {
          employeeId: (row[indexMap.employeeId] ?? "").trim(),
          fullName: (row[indexMap.fullName] ?? "").trim(),
          roleType: indexMap.roleType >= 0 ? (row[indexMap.roleType] ?? "").trim() || "EMPLOYEE" : "EMPLOYEE",
          canteenId: indexMap.canteenId >= 0 ? (row[indexMap.canteenId] ?? "").trim() || null : null,
          departmentId: 
            indexMap.departmentId >= 0 
              ? (row[indexMap.departmentId] ?? "").trim() || null
              : null,
          designation: (row[indexMap.designation] ?? "").trim(),
          email: (row[indexMap.email] ?? "").trim(),
          phone: (row[indexMap.phone] ?? "").trim(),
          joiningDate: normalizeJoiningDate((row[indexMap.joiningDate] ?? "").trim()),
          gender: indexMap.gender >= 0 ? (row[indexMap.gender] ?? "").trim() : "",
          address: indexMap.address >= 0 ? (row[indexMap.address] ?? "").trim() : "",
        };
      } catch (err) {
        console.error(`Error parsing row ${rowIdx}:`, err);
        return null;
      }
    })
    .filter(
      (row): row is EmployeeInput =>
        row !== null &&
        !!row.employeeId &&
        !!row.fullName &&
        !!row.designation &&
        !!row.email &&
        !!row.phone &&
        !!row.joiningDate
    );
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
}

function toIsoDate(year: number, month: number, day: number): string {
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeJoiningDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map((part) => Number(part));
    return isValidDateParts(y, m, d) ? trimmed : "";
  }

  if (/^\d{5}$/.test(trimmed)) {
    const excelSerial = Number(trimmed);
    if (excelSerial > 0) {
      const base = Date.UTC(1899, 11, 30);
      const converted = new Date(base + excelSerial * 86400000);
      const y = converted.getUTCFullYear();
      const m = converted.getUTCMonth() + 1;
      const d = converted.getUTCDate();
      return isValidDateParts(y, m, d) ? toIsoDate(y, m, d) : "";
    }
  }

  const parts = trimmed.split(/[/-]/).map((part) => part.trim());
  if (parts.length !== 3) return "";

  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isFinite(n))) return "";

  const [a, b, c] = nums;

  if (String(parts[0]).length === 4) {
    return isValidDateParts(a, b, c) ? toIsoDate(a, b, c) : "";
  }

  if (String(parts[2]).length === 4) {
    const year = c;
    const dayFirst = isValidDateParts(year, b, a);
    const monthFirst = isValidDateParts(year, a, b);

    if (dayFirst && !monthFirst) return toIsoDate(year, b, a);
    if (!dayFirst && monthFirst) return toIsoDate(year, a, b);
    if (dayFirst && monthFirst) return toIsoDate(year, b, a);
  }

  return "";
}
