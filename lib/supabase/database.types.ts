export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      batch_runs: {
        Row: {
          by_bus: Json | null
          elapsed_ms: number | null
          empty_seats: Json | null
          error_message: string | null
          id: string
          run_at: string
          run_by: string | null
          success: boolean
          total_assigned: number | null
          trigger_reason: string | null
        }
        Insert: {
          by_bus?: Json | null
          elapsed_ms?: number | null
          empty_seats?: Json | null
          error_message?: string | null
          id?: string
          run_at?: string
          run_by?: string | null
          success?: boolean
          total_assigned?: number | null
          trigger_reason?: string | null
        }
        Update: {
          by_bus?: Json | null
          elapsed_ms?: number | null
          empty_seats?: Json | null
          error_message?: string | null
          id?: string
          run_at?: string
          run_by?: string | null
          success?: boolean
          total_assigned?: number | null
          trigger_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_runs_run_by_fkey"
            columns: ["run_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      buses: {
        Row: {
          capacity: number
          departure_slot_id: number
          down_driver_registration_id: string | null
          down_fixed_passenger_ids: string[]
          driver_registration_id: string | null
          fixed_passenger_ids: string[]
          hard_cap: number
          id: number
          name: string
        }
        Insert: {
          capacity?: number
          departure_slot_id: number
          down_driver_registration_id?: string | null
          down_fixed_passenger_ids?: string[]
          driver_registration_id?: string | null
          fixed_passenger_ids?: string[]
          hard_cap?: number
          id?: number
          name: string
        }
        Update: {
          capacity?: number
          departure_slot_id?: number
          down_driver_registration_id?: string | null
          down_fixed_passenger_ids?: string[]
          driver_registration_id?: string | null
          fixed_passenger_ids?: string[]
          hard_cap?: number
          id?: number
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "buses_driver_registration_id_fkey"
            columns: ["driver_registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_down_driver_registration_id_fkey"
            columns: ["down_driver_registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_departure_slot_id_fkey"
            columns: ["departure_slot_id"]
            isOneToOne: false
            referencedRelation: "departure_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      departure_slots: {
        Row: {
          active: boolean
          created_at: string
          display_order: number
          id: number
          key: string
          label: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_order?: number
          id?: number
          key: string
          label: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_order?: number
          id?: number
          key?: string
          label?: string
        }
        Relationships: []
      }
      campus_remittances: {
        Row: {
          id: string
          campus_id: string
          amount: number
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          campus_id: string
          amount: number
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          campus_id?: string
          amount?: number
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      campus_payment_settlements: {
        Row: {
          campus_id: string
          campus_remitted_at: string | null
          campus_remitted_by: string | null
          campus_remitted_note: string | null
          campus_remitted_total: number
          master_received_at: string | null
          master_received_note: string | null
          master_received_total: number
          updated_at: string
        }
        Insert: {
          campus_id: string
          campus_remitted_at?: string | null
          campus_remitted_by?: string | null
          campus_remitted_note?: string | null
          campus_remitted_total?: number
          master_received_at?: string | null
          master_received_note?: string | null
          master_received_total?: number
          updated_at?: string
        }
        Update: {
          campus_id?: string
          campus_remitted_at?: string | null
          campus_remitted_by?: string | null
          campus_remitted_note?: string | null
          campus_remitted_total?: number
          master_received_at?: string | null
          master_received_note?: string | null
          master_received_total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campus_payment_settlements_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: true
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_payment_settlements_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: true
            referencedRelation: "v_campus_stats"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_payment_settlements_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: true
            referencedRelation: "v_payment_3way_comparison"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_payment_settlements_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: true
            referencedRelation: "v_payment_summary"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_payment_settlements_campus_remitted_by_fkey"
            columns: ["campus_remitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campuses: {
        Row: {
          created_at: string
          display_order: number
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          campus_id: string | null
          created_at: string
          display_name: string | null
          id: string
          provider_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          campus_id?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          provider_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          campus_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          provider_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "v_campus_stats"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "profiles_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "v_payment_3way_comparison"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "profiles_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "v_payment_summary"
            referencedColumns: ["campus_id"]
          },
        ]
      }
      registration_audit: {
        Row: {
          after_value: Json | null
          before_value: Json | null
          change_type: Database["public"]["Enums"]["request_type"]
          changed_by: string | null
          created_at: string
          id: string
          registration_id: string
        }
        Insert: {
          after_value?: Json | null
          before_value?: Json | null
          change_type: Database["public"]["Enums"]["request_type"]
          changed_by?: string | null
          created_at?: string
          id?: string
          registration_id: string
        }
        Update: {
          after_value?: Json | null
          before_value?: Json | null
          change_type?: Database["public"]["Enums"]["request_type"]
          changed_by?: string | null
          created_at?: string
          id?: string
          registration_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "registration_audit_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      registrations: {
        Row: {
          assigned_down_bus_id: number | null
          assigned_up_bus_id: number | null
          attendance_type: Database["public"]["Enums"]["attendance_type"]
          campus_id: string
          checked_in: boolean
          checked_out: boolean
          created_at: string
          created_by: string | null
          departure_slot_id: number | null
          fee: number | null
          id: string
          name: string
          note: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          roles: string[]
          student_id: string
          updated_at: string
          uses_return_bus: boolean
          version: number
        }
        Insert: {
          assigned_down_bus_id?: number | null
          assigned_up_bus_id?: number | null
          attendance_type: Database["public"]["Enums"]["attendance_type"]
          campus_id: string
          checked_in?: boolean
          checked_out?: boolean
          created_at?: string
          created_by?: string | null
          departure_slot_id?: number | null
          fee?: number | null
          id?: string
          name: string
          note?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          roles?: string[]
          student_id: string
          updated_at?: string
          uses_return_bus?: boolean
          version?: number
        }
        Update: {
          assigned_down_bus_id?: number | null
          assigned_up_bus_id?: number | null
          attendance_type?: Database["public"]["Enums"]["attendance_type"]
          campus_id?: string
          checked_in?: boolean
          checked_out?: boolean
          created_at?: string
          created_by?: string | null
          departure_slot_id?: number | null
          fee?: number | null
          id?: string
          name?: string
          note?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          roles?: string[]
          student_id?: string
          updated_at?: string
          uses_return_bus?: boolean
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "registrations_assigned_down_bus_id_fkey"
            columns: ["assigned_down_bus_id"]
            isOneToOne: false
            referencedRelation: "buses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_assigned_down_bus_id_fkey"
            columns: ["assigned_down_bus_id"]
            isOneToOne: false
            referencedRelation: "v_bus_occupancy"
            referencedColumns: ["bus_id"]
          },
          {
            foreignKeyName: "registrations_assigned_up_bus_id_fkey"
            columns: ["assigned_up_bus_id"]
            isOneToOne: false
            referencedRelation: "buses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_assigned_up_bus_id_fkey"
            columns: ["assigned_up_bus_id"]
            isOneToOne: false
            referencedRelation: "v_bus_occupancy"
            referencedColumns: ["bus_id"]
          },
          {
            foreignKeyName: "registrations_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "v_campus_stats"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "registrations_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "v_payment_3way_comparison"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "registrations_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "v_payment_summary"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "registrations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_departure_slot_id_fkey"
            columns: ["departure_slot_id"]
            isOneToOne: false
            referencedRelation: "departure_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      role_labels: {
        Row: {
          color: string | null
          created_at: string
          display_order: number
          id: string
          label: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          display_order?: number
          id?: string
          label: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          display_order?: number
          id?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_config: {
        Row: {
          batch_enabled: boolean
          current_phase: Database["public"]["Enums"]["system_phase"]
          id: number
          last_batch_at: string | null
          phase2_started_at: string | null
          updated_at: string
        }
        Insert: {
          batch_enabled?: boolean
          current_phase?: Database["public"]["Enums"]["system_phase"]
          id?: number
          last_batch_at?: string | null
          phase2_started_at?: string | null
          updated_at?: string
        }
        Update: {
          batch_enabled?: boolean
          current_phase?: Database["public"]["Enums"]["system_phase"]
          id?: number
          last_batch_at?: string | null
          phase2_started_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_bus_occupancy: {
        Row: {
          bus_id: number | null
          bus_name: string | null
          capacity: number | null
          departure_slot_id: number | null
          down_empty_seats: number | null
          down_passengers: number | null
          hard_cap: number | null
          up_empty_seats: number | null
          up_passengers: number | null
        }
        Relationships: [
          {
            foreignKeyName: "buses_departure_slot_id_fkey"
            columns: ["departure_slot_id"]
            isOneToOne: false
            referencedRelation: "departure_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      v_campus_stats: {
        Row: {
          campus_id: string | null
          campus_name: string | null
          oneway_count: number | null
          roundtrip_count: number | null
          arrived_count: number | null
          return_target: number | null
          returned_count: number | null
          self_count: number | null
          total: number | null
        }
        Relationships: []
      }
      v_day_capacity: {
        Row: {
          display_order: number | null
          remaining_seats: number | null
          slot_id: number | null
          slot_key: string | null
          slot_label: string | null
          total_capacity: number | null
          total_passengers: number | null
        }
        Relationships: []
      }
      v_payment_3way_comparison: {
        Row: {
          campus_id: string | null
          campus_name: string | null
          campus_remitted_total: number | null
          diff_campus_vs_master: number | null
          diff_system_vs_campus: number | null
          diff_system_vs_master: number | null
          master_received_total: number | null
          system_paid_total: number | null
        }
        Relationships: []
      }
      v_payment_summary: {
        Row: {
          campus_id: string | null
          campus_name: string | null
          paid_count: number | null
          paid_total: number | null
          unpaid_count: number | null
          unpaid_total: number | null
          waived_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      campus_remit_add: {
        Args: { p_amount: number; p_note?: string | null }
        Returns: undefined
      }
      campus_remit_delete: { Args: { p_id: string }; Returns: undefined }
      current_campus: { Args: never; Returns: string }
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
    }
    Enums: {
      attendance_type: "roundtrip" | "oneway" | "self"
      payment_status: "unpaid" | "paid" | "waived"
      request_type: "insert" | "update" | "delete"
      system_phase: "phase1" | "phase2"
      user_role: "guest" | "campus_admin" | "viewer" | "master"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      attendance_type: ["roundtrip", "oneway", "self"],
      payment_status: ["unpaid", "paid", "waived"],
      request_type: ["insert", "update", "delete"],
      system_phase: ["phase1", "phase2"],
      user_role: ["guest", "campus_admin", "viewer", "master"],
    },
  },
} as const
