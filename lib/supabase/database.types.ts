export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      batch_runs: {
        Row: {
          by_bus: Json | null
          elapsed_ms: number | null
          empty_seats: Json | null
          error_message: string | null
          event_id: string
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
          event_id: string
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
          event_id?: string
          id?: string
          run_at?: string
          run_by?: string | null
          success?: boolean
          total_assigned?: number | null
          trigger_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
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
          display_order: number
          down_driver_registration_id: string | null
          down_fixed_passenger_ids: string[]
          down_trip_id: number | null
          driver_registration_id: string | null
          event_id: string
          fill_priority: number
          fixed_passenger_ids: string[]
          hard_cap: number
          id: number
          is_cohesion_exempt: boolean
          name: string
          up_trip_id: number | null
        }
        Insert: {
          capacity?: number
          display_order?: number
          down_driver_registration_id?: string | null
          down_fixed_passenger_ids?: string[]
          down_trip_id?: number | null
          driver_registration_id?: string | null
          event_id: string
          fill_priority?: number
          fixed_passenger_ids?: string[]
          hard_cap?: number
          id?: number
          is_cohesion_exempt?: boolean
          name: string
          up_trip_id?: number | null
        }
        Update: {
          capacity?: number
          display_order?: number
          down_driver_registration_id?: string | null
          down_fixed_passenger_ids?: string[]
          down_trip_id?: number | null
          driver_registration_id?: string | null
          event_id?: string
          fill_priority?: number
          fixed_passenger_ids?: string[]
          hard_cap?: number
          id?: number
          is_cohesion_exempt?: boolean
          name?: string
          up_trip_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "buses_down_driver_registration_id_fkey"
            columns: ["down_driver_registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_down_driver_registration_id_fkey"
            columns: ["down_driver_registration_id"]
            isOneToOne: false
            referencedRelation: "v_cancelled"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "buses_down_driver_registration_id_fkey"
            columns: ["down_driver_registration_id"]
            isOneToOne: false
            referencedRelation: "v_payment_balance"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "buses_down_driver_registration_id_fkey"
            columns: ["down_driver_registration_id"]
            isOneToOne: false
            referencedRelation: "v_transport_summary"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "buses_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "departure_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "event_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "v_day_capacity"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "buses_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "v_down_capacity"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "buses_driver_registration_id_fkey"
            columns: ["driver_registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_driver_registration_id_fkey"
            columns: ["driver_registration_id"]
            isOneToOne: false
            referencedRelation: "v_cancelled"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "buses_driver_registration_id_fkey"
            columns: ["driver_registration_id"]
            isOneToOne: false
            referencedRelation: "v_payment_balance"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "buses_driver_registration_id_fkey"
            columns: ["driver_registration_id"]
            isOneToOne: false
            referencedRelation: "v_transport_summary"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "buses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "departure_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "event_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "v_day_capacity"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "v_down_capacity"
            referencedColumns: ["trip_id"]
          },
        ]
      }
      campus_payment_settlements: {
        Row: {
          campus_id: string
          campus_remitted_at: string | null
          campus_remitted_by: string | null
          campus_remitted_note: string | null
          campus_remitted_total: number
          event_id: string
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
          event_id: string
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
          event_id?: string
          master_received_at?: string | null
          master_received_note?: string | null
          master_received_total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campus_payment_settlements_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_payment_settlements_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "v_campus_stats"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_payment_settlements_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "v_payment_3way_comparison"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_payment_settlements_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
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
          {
            foreignKeyName: "campus_payment_settlements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      campus_remittances: {
        Row: {
          amount: number
          campus_id: string
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          note: string | null
        }
        Insert: {
          amount: number
          campus_id: string
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          note?: string | null
        }
        Update: {
          amount?: number
          campus_id?: string
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campus_remittances_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_remittances_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "v_campus_stats"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_remittances_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "v_payment_3way_comparison"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_remittances_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "v_payment_summary"
            referencedColumns: ["campus_id"]
          },
          {
            foreignKeyName: "campus_remittances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_remittances_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
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
      event_trips: {
        Row: {
          active: boolean
          created_at: string
          departs_at: string | null
          destination: string | null
          direction: string
          display_order: number
          event_id: string
          id: number
          key: string
          label: string
          origin: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          departs_at?: string | null
          destination?: string | null
          direction?: string
          display_order?: number
          event_id: string
          id?: never
          key: string
          label: string
          origin?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          departs_at?: string | null
          destination?: string | null
          direction?: string
          display_order?: number
          event_id?: string
          id?: never
          key?: string
          label?: string
          origin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_trips_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          destination: string | null
          ends_on: string | null
          fee_oneway: number
          fee_roundtrip: number
          id: string
          is_active: boolean
          name: string
          origin: string | null
          starts_on: string | null
          subtitle: string | null
          unlock_reason: string | null
          unlock_until: string | null
          write_mode: Database["public"]["Enums"]["event_write_mode"]
        }
        Insert: {
          created_at?: string
          destination?: string | null
          ends_on?: string | null
          fee_oneway?: number
          fee_roundtrip?: number
          id?: string
          is_active?: boolean
          name: string
          origin?: string | null
          starts_on?: string | null
          subtitle?: string | null
          unlock_reason?: string | null
          unlock_until?: string | null
          write_mode?: Database["public"]["Enums"]["event_write_mode"]
        }
        Update: {
          created_at?: string
          destination?: string | null
          ends_on?: string | null
          fee_oneway?: number
          fee_roundtrip?: number
          id?: string
          is_active?: boolean
          name?: string
          origin?: string | null
          starts_on?: string | null
          subtitle?: string | null
          unlock_reason?: string | null
          unlock_until?: string | null
          write_mode?: Database["public"]["Enums"]["event_write_mode"]
        }
        Relationships: []
      }
      org_units: {
        Row: {
          aliases: string[]
          created_at: string
          display_order: number
          id: string
          kind: string
          name: string
          retired_at: string | null
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          display_order?: number
          id?: string
          kind?: string
          name: string
          retired_at?: string | null
        }
        Update: {
          aliases?: string[]
          created_at?: string
          display_order?: number
          id?: string
          kind?: string
          name?: string
          retired_at?: string | null
        }
        Relationships: []
      }
      pickup_places: {
        Row: {
          active: boolean
          created_at: string
          display_order: number
          event_id: string
          id: number
          name: string
          note: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_order?: number
          event_id: string
          id?: never
          name: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_order?: number
          event_id?: string
          id?: never
          name?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_places_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_requests: {
        Row: {
          created_at: string
          direction: string
          event_id: string
          id: number
          note: string | null
          pickup_at: string | null
          place_id: number | null
          registration_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          direction: string
          event_id: string
          id?: never
          note?: string | null
          pickup_at?: string | null
          place_id?: number | null
          registration_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          direction?: string
          event_id?: string
          id?: never
          note?: string | null
          pickup_at?: string | null
          place_id?: number | null
          registration_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_requests_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "pickup_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_requests_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_ledger: {
        Row: {
          actor: string | null
          amount: number
          created_at: string
          event_id: string
          id: string
          kind: string
          occurred_at: string
          reason: string | null
          registration_id: string
          source: string
        }
        Insert: {
          actor?: string | null
          amount: number
          created_at?: string
          event_id: string
          id?: string
          kind: string
          occurred_at?: string
          reason?: string | null
          registration_id: string
          source?: string
        }
        Update: {
          actor?: string | null
          amount?: number
          created_at?: string
          event_id?: string
          id?: string
          kind?: string
          occurred_at?: string
          reason?: string | null
          registration_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_ledger_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_ledger_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_ledger_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_ledger_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "v_cancelled"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "payment_ledger_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "v_payment_balance"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "payment_ledger_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "v_transport_summary"
            referencedColumns: ["registration_id"]
          },
        ]
      }
      profiles: {
        Row: {
          campus_id: string | null
          created_at: string
          display_name: string | null
          driver_bus_id: number | null
          id: string
          provider_id: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          campus_id?: string | null
          created_at?: string
          display_name?: string | null
          driver_bus_id?: number | null
          id: string
          provider_id?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          campus_id?: string | null
          created_at?: string
          display_name?: string | null
          driver_bus_id?: number | null
          id?: string
          provider_id?: string | null
          revoked_at?: string | null
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
          {
            foreignKeyName: "profiles_driver_bus_id_fkey"
            columns: ["driver_bus_id"]
            isOneToOne: false
            referencedRelation: "buses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_driver_bus_id_fkey"
            columns: ["driver_bus_id"]
            isOneToOne: false
            referencedRelation: "v_bus_occupancy"
            referencedColumns: ["bus_id"]
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
          event_id: string
          id: string
          registration_id: string
        }
        Insert: {
          after_value?: Json | null
          before_value?: Json | null
          change_type: Database["public"]["Enums"]["request_type"]
          changed_by?: string | null
          created_at?: string
          event_id: string
          id?: string
          registration_id: string
        }
        Update: {
          after_value?: Json | null
          before_value?: Json | null
          change_type?: Database["public"]["Enums"]["request_type"]
          changed_by?: string | null
          created_at?: string
          event_id?: string
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
          {
            foreignKeyName: "registration_audit_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      registrations: {
        Row: {
          assigned_down_bus_id: number | null
          assigned_up_bus_id: number | null
          attend_from: string | null
          attend_to: string | null
          attendance_type: Database["public"]["Enums"]["attendance_type"]
          campus_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          checked_in: boolean
          checked_out: boolean
          created_at: string
          created_by: string | null
          departure_slot_id: number | null
          down_trip_id: number | null
          event_id: string
          fee: number | null
          home_unit_id: string | null
          id: string
          name: string
          note: string | null
          participation_status: Database["public"]["Enums"]["participation_status"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          roles: string[]
          student_id: string
          up_trip_id: number | null
          updated_at: string
          uses_return_bus: boolean
          version: number
        }
        Insert: {
          assigned_down_bus_id?: number | null
          assigned_up_bus_id?: number | null
          attend_from?: string | null
          attend_to?: string | null
          attendance_type?: Database["public"]["Enums"]["attendance_type"]
          campus_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          checked_in?: boolean
          checked_out?: boolean
          created_at?: string
          created_by?: string | null
          departure_slot_id?: number | null
          down_trip_id?: number | null
          event_id: string
          fee?: number | null
          home_unit_id?: string | null
          id?: string
          name: string
          note?: string | null
          participation_status?: Database["public"]["Enums"]["participation_status"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          roles?: string[]
          student_id: string
          up_trip_id?: number | null
          updated_at?: string
          uses_return_bus?: boolean
          version?: number
        }
        Update: {
          assigned_down_bus_id?: number | null
          assigned_up_bus_id?: number | null
          attend_from?: string | null
          attend_to?: string | null
          attendance_type?: Database["public"]["Enums"]["attendance_type"]
          campus_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          checked_in?: boolean
          checked_out?: boolean
          created_at?: string
          created_by?: string | null
          departure_slot_id?: number | null
          down_trip_id?: number | null
          event_id?: string
          fee?: number | null
          home_unit_id?: string | null
          id?: string
          name?: string
          note?: string | null
          participation_status?: Database["public"]["Enums"]["participation_status"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          roles?: string[]
          student_id?: string
          up_trip_id?: number | null
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
            foreignKeyName: "registrations_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "registrations_departure_slot_id_fkey"
            columns: ["departure_slot_id"]
            isOneToOne: false
            referencedRelation: "event_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_departure_slot_id_fkey"
            columns: ["departure_slot_id"]
            isOneToOne: false
            referencedRelation: "v_day_capacity"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "registrations_departure_slot_id_fkey"
            columns: ["departure_slot_id"]
            isOneToOne: false
            referencedRelation: "v_down_capacity"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "registrations_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "departure_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "event_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "v_day_capacity"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "registrations_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "v_down_capacity"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_home_unit_id_fkey"
            columns: ["home_unit_id"]
            isOneToOne: false
            referencedRelation: "org_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "departure_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "event_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "v_day_capacity"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "registrations_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "v_down_capacity"
            referencedColumns: ["trip_id"]
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
      transport_legs: {
        Row: {
          created_at: string
          direction: string
          event_id: string
          id: number
          mode: Database["public"]["Enums"]["transport_mode"]
          note: string | null
          registration_id: string
          status: Database["public"]["Enums"]["transport_status"]
          updated_at: string
          via_unit_id: string | null
        }
        Insert: {
          created_at?: string
          direction: string
          event_id: string
          id?: never
          mode: Database["public"]["Enums"]["transport_mode"]
          note?: string | null
          registration_id: string
          status?: Database["public"]["Enums"]["transport_status"]
          updated_at?: string
          via_unit_id?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          event_id?: string
          id?: never
          mode?: Database["public"]["Enums"]["transport_mode"]
          note?: string | null
          registration_id?: string
          status?: Database["public"]["Enums"]["transport_status"]
          updated_at?: string
          via_unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transport_legs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_legs_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_legs_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "v_cancelled"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "transport_legs_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "v_payment_balance"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "transport_legs_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "v_transport_summary"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "transport_legs_via_unit_id_fkey"
            columns: ["via_unit_id"]
            isOneToOne: false
            referencedRelation: "org_units"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      departure_slots: {
        Row: {
          active: boolean | null
          created_at: string | null
          display_order: number | null
          event_id: string | null
          id: number | null
          key: string | null
          label: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          display_order?: number | null
          event_id?: string | null
          id?: number | null
          key?: string | null
          label?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          display_order?: number | null
          event_id?: string | null
          id?: number | null
          key?: string | null
          label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_trips_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      v_bus_occupancy: {
        Row: {
          bus_id: number | null
          bus_name: string | null
          capacity: number | null
          departure_slot_id: number | null
          down_empty_seats: number | null
          down_passengers: number | null
          down_trip_id: number | null
          hard_cap: number | null
          up_empty_seats: number | null
          up_passengers: number | null
          up_trip_id: number | null
        }
        Insert: {
          bus_id?: number | null
          bus_name?: string | null
          capacity?: number | null
          departure_slot_id?: number | null
          down_empty_seats?: never
          down_passengers?: never
          down_trip_id?: number | null
          hard_cap?: number | null
          up_empty_seats?: never
          up_passengers?: never
          up_trip_id?: number | null
        }
        Update: {
          bus_id?: number | null
          bus_name?: string | null
          capacity?: number | null
          departure_slot_id?: number | null
          down_empty_seats?: never
          down_passengers?: never
          down_trip_id?: number | null
          hard_cap?: number | null
          up_empty_seats?: never
          up_passengers?: never
          up_trip_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "buses_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "departure_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "event_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "v_day_capacity"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "buses_down_trip_id_fkey"
            columns: ["down_trip_id"]
            isOneToOne: false
            referencedRelation: "v_down_capacity"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["departure_slot_id"]
            isOneToOne: false
            referencedRelation: "departure_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "departure_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["departure_slot_id"]
            isOneToOne: false
            referencedRelation: "event_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "event_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["departure_slot_id"]
            isOneToOne: false
            referencedRelation: "v_day_capacity"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "v_day_capacity"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["departure_slot_id"]
            isOneToOne: false
            referencedRelation: "v_down_capacity"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "buses_up_trip_id_fkey"
            columns: ["up_trip_id"]
            isOneToOne: false
            referencedRelation: "v_down_capacity"
            referencedColumns: ["trip_id"]
          },
        ]
      }
      v_campus_stats: {
        Row: {
          arrived_count: number | null
          campus_id: string | null
          campus_name: string | null
          oneway_count: number | null
          return_target: number | null
          returned_count: number | null
          roundtrip_count: number | null
          self_count: number | null
          total: number | null
        }
        Relationships: []
      }
      v_cancelled: {
        Row: {
          balance: number | null
          campus_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          fee: number | null
          name: string | null
          note: string | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          registration_id: string | null
          student_id: string | null
        }
        Relationships: [
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
        ]
      }
      v_day_capacity: {
        Row: {
          arrived: number | null
          departs_at: string | null
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
      v_down_capacity: {
        Row: {
          departs_at: string | null
          display_order: number | null
          remaining_seats: number | null
          returned: number | null
          total_capacity: number | null
          total_passengers: number | null
          trip_id: number | null
          trip_key: string | null
          trip_label: string | null
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
      v_payment_balance: {
        Row: {
          balance: number | null
          campus_id: string | null
          charged_now: number | null
          charged_total: number | null
          event_id: string | null
          fee_now: number | null
          name: string | null
          note: string | null
          paid_total: number | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          refund_due: number | null
          refund_reason: string | null
          refunded_total: number | null
          registration_id: string | null
          waived_total: number | null
        }
        Relationships: [
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
            foreignKeyName: "registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
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
      v_registration_changes: {
        Row: {
          campus_id: string | null
          change_type: Database["public"]["Enums"]["request_type"] | null
          changed_by: string | null
          changed_fields: string[] | null
          created_at: string | null
          event_id: string | null
          id: string | null
          person_name: string | null
          registration_id: string | null
          student_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registration_audit_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_audit_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      v_pickup_board: {
        Row: {
          attend_from: string | null
          attend_to: string | null
          campus_id: string | null
          campus_name: string | null
          created_at: string | null
          direction: string | null
          event_id: string | null
          id: number | null
          note: string | null
          participation_status:
            | Database["public"]["Enums"]["participation_status"]
            | null
          person_name: string | null
          pickup_at: string | null
          pickup_date: string | null
          pickup_time: string | null
          place: string | null
          place_id: number | null
          place_note: string | null
          registration_id: string | null
          student_id: string | null
        }
        Relationships: []
      }
      v_transport_legs_detail: {
        Row: {
          campus_id: string | null
          campus_name: string | null
          created_at: string | null
          days_waiting: number | null
          direction: string | null
          event_id: string | null
          held_bus_id: number | null
          held_trip_id: number | null
          id: number | null
          mode: Database["public"]["Enums"]["transport_mode"] | null
          note: string | null
          participation_status:
            | Database["public"]["Enums"]["participation_status"]
            | null
          person_name: string | null
          registration_id: string | null
          status: Database["public"]["Enums"]["transport_status"] | null
          student_id: string | null
          updated_at: string | null
          via_unit_id: string | null
          via_unit_name: string | null
        }
        Relationships: []
      }
      v_transport_summary: {
        Row: {
          down_mode: Database["public"]["Enums"]["transport_mode"] | null
          down_status: Database["public"]["Enums"]["transport_status"] | null
          down_via_unit: string | null
          event_id: string | null
          has_pending: boolean | null
          registration_id: string | null
          up_mode: Database["public"]["Enums"]["transport_mode"] | null
          up_status: Database["public"]["Enums"]["transport_status"] | null
          up_via_unit: string | null
          uses_other_transport: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      activate_event: { Args: { p_event_id: string }; Returns: undefined }
      active_event_id: { Args: never; Returns: string }
      campus_remit_add: {
        Args: { p_amount: number; p_note?: string }
        Returns: undefined
      }
      campus_remit_delete: { Args: { p_id: string }; Returns: undefined }
      create_event: {
        Args: {
          p_copy_buses?: boolean
          p_copy_trips?: boolean
          p_destination?: string
          p_ends_on?: string
          p_fee_oneway?: number
          p_fee_roundtrip?: number
          p_name: string
          p_origin?: string
          p_starts_on?: string
          p_subtitle?: string
        }
        Returns: string
      }
      current_campus: { Args: never; Returns: string }
      current_driver_bus: { Args: never; Returns: number }
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      derive_attendance: {
        Args: { p_down: number; p_up: number }
        Returns: Database["public"]["Enums"]["attendance_type"]
      }
      event_summary: {
        Args: never
        Returns: {
          batch_count: number
          event_id: string
          reg_count: number
        }[]
      }
      is_event_writable: { Args: { p_event: string }; Returns: boolean }
      lock_event_writes: { Args: { p_event_id: string }; Returns: undefined }
      master_remit_add: {
        Args: { p_amount: number; p_campus_id: string; p_note?: string }
        Returns: undefined
      }
      request_event_header: { Args: never; Returns: string }
      set_attendance: {
        Args: { p_field: string; p_reg_id: string; p_value: boolean }
        Returns: undefined
      }
      unlock_event_writes: {
        Args: { p_event_id: string; p_minutes?: number; p_reason: string }
        Returns: string
      }
      update_event_fares: {
        Args: {
          p_event_id: string
          p_fee_oneway: number
          p_fee_roundtrip: number
        }
        Returns: undefined
      }
      viewing_event_id: { Args: never; Returns: string }
      writable_event_id: { Args: never; Returns: string }
    }
    Enums: {
      attendance_type: "roundtrip" | "oneway" | "self"
      event_write_mode: "live" | "closed"
      participation_status: "registered" | "cancelled"
      payment_status: "unpaid" | "paid" | "waived"
      request_type: "insert" | "update" | "delete"
      system_phase: "phase1" | "phase2"
      transport_mode: "our_bus" | "other_district" | "ktx" | "own_car" | "other"
      transport_status: "confirmed" | "pending"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      attendance_type: ["roundtrip", "oneway", "self"],
      event_write_mode: ["live", "closed"],
      participation_status: ["registered", "cancelled"],
      payment_status: ["unpaid", "paid", "waived"],
      request_type: ["insert", "update", "delete"],
      system_phase: ["phase1", "phase2"],
      transport_mode: ["our_bus", "other_district", "ktx", "own_car", "other"],
      transport_status: ["confirmed", "pending"],
      user_role: ["guest", "campus_admin", "viewer", "master"],
    },
  },
} as const

