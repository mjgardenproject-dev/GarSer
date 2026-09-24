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
      admin_audit_logs: {
        Row: {
          action_type: string
          admin_id: string | null
          created_at: string | null
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          target_id: string | null
          target_table: string | null
          user_agent: string | null
        }
        Insert: {
          action_type: string
          admin_id?: string | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Update: {
          action_type?: string
          admin_id?: string | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      ai_analysis_logs: {
        Row: {
          created_at: string
          id: string
          latency_ms: number
          prompt_version: string
          raw_response: Json
          request_id: string | null
          service_name: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          latency_ms: number
          prompt_version: string
          raw_response: Json
          request_id?: string | null
          service_name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          latency_ms?: number
          prompt_version?: string
          raw_response?: Json
          request_id?: string | null
          service_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ai_analysis_rate_limits: {
        Row: {
          request_count: number
          subject: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          request_count?: number
          subject: string
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          request_count?: number
          subject?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      ai_pricing_rate_limits: {
        Row: {
          request_count: number
          updated_at: string
          user_id: string
          window_started_at: string
        }
        Insert: {
          request_count?: number
          updated_at?: string
          user_id: string
          window_started_at?: string
        }
        Update: {
          request_count?: number
          updated_at?: string
          user_id?: string
          window_started_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          business_name: string
          contact_email: string
          contact_phone: string
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          business_name?: string
          contact_email?: string
          contact_phone?: string
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          business_name?: string
          contact_email?: string
          contact_phone?: string
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      availability: {
        Row: {
          created_at: string | null
          date: string
          end_time: string
          gardener_id: string | null
          id: string
          is_available: boolean | null
          start_time: string
        }
        Insert: {
          created_at?: string | null
          date: string
          end_time: string
          gardener_id?: string | null
          id?: string
          is_available?: boolean | null
          start_time: string
        }
        Update: {
          created_at?: string | null
          date?: string
          end_time?: string
          gardener_id?: string | null
          id?: string
          is_available?: boolean | null
          start_time?: string
        }
        Relationships: []
      }
      availability_blocks: {
        Row: {
          created_at: string | null
          date: string
          gardener_id: string | null
          hour_block: number
          id: string
          is_available: boolean | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          gardener_id?: string | null
          hour_block: number
          id?: string
          is_available?: boolean | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          gardener_id?: string | null
          hour_block?: number
          id?: string
          is_available?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      booking_batch_rpc_idempotency: {
        Row: {
          action: string
          actor_id: string
          batch_key: string
          completed_at: string | null
          created_at: string
          operation_id: string
          payload_signature: string
          response_payload: Json | null
        }
        Insert: {
          action: string
          actor_id: string
          batch_key: string
          completed_at?: string | null
          created_at?: string
          operation_id: string
          payload_signature: string
          response_payload?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string
          batch_key?: string
          completed_at?: string | null
          created_at?: string
          operation_id?: string
          payload_signature?: string
          response_payload?: Json | null
        }
        Relationships: []
      }
      booking_blocks: {
        Row: {
          assignee_id: string
          booking_id: string | null
          created_at: string | null
          date: string
          hour_block: number
          id: string
        }
        Insert: {
          assignee_id: string
          booking_id?: string | null
          created_at?: string | null
          date: string
          hour_block: number
          id?: string
        }
        Update: {
          assignee_id?: string
          booking_id?: string | null
          created_at?: string | null
          date?: string
          hour_block?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_blocks_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_confirmation_tokens: {
        Row: {
          booking_id: string
          created_at: string
          expires_at: string
          id: string
          purpose: string
          token_hash: string
          used_at: string | null
          used_ip: unknown
          used_user_agent: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          expires_at: string
          id?: string
          purpose?: string
          token_hash: string
          used_at?: string | null
          used_ip?: unknown
          used_user_agent?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          purpose?: string
          token_hash?: string
          used_at?: string | null
          used_ip?: unknown
          used_user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_confirmation_tokens_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_funnel_events: {
        Row: {
          context: Json
          created_at: string
          event: string
          id: string
          level: string
          path: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          event: string
          id?: string
          level: string
          path?: string | null
          source?: string
          user_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          event?: string
          id?: string
          level?: string
          path?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      booking_incident_events: {
        Row: {
          actor_id: string | null
          context: Json
          created_at: string
          from_status: string | null
          id: string
          incident_id: string
          note: string | null
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          context?: Json
          created_at?: string
          from_status?: string | null
          id?: string
          incident_id: string
          note?: string | null
          to_status: string
        }
        Update: {
          actor_id?: string | null
          context?: Json
          created_at?: string
          from_status?: string | null
          id?: string
          incident_id?: string
          note?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_incident_events_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "booking_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_incidents: {
        Row: {
          blocks_completion: boolean | null
          booking_id: string
          created_at: string
          description: string
          gardener_responded_at: string | null
          gardener_response: string | null
          id: string
          kind: string
          money_action: string | null
          money_attempted_at: string | null
          money_status: string | null
          reported_by: string
          reporter_role: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          blocks_completion?: boolean | null
          booking_id: string
          created_at?: string
          description: string
          gardener_responded_at?: string | null
          gardener_response?: string | null
          id?: string
          kind: string
          money_action?: string | null
          money_attempted_at?: string | null
          money_status?: string | null
          reported_by: string
          reporter_role: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          blocks_completion?: boolean | null
          booking_id?: string
          created_at?: string
          description?: string
          gardener_responded_at?: string | null
          gardener_response?: string | null
          id?: string
          kind?: string
          money_action?: string | null
          money_attempted_at?: string | null
          money_status?: string | null
          reported_by?: string
          reporter_role?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_items: {
        Row: {
          booking_id: string
          breakdown: Json
          created_at: string
          id: string
          input_payload: Json
          labour_hours: number
          position: number
          requires_license: boolean
          service_id: string
          total_price: number
        }
        Insert: {
          booking_id: string
          breakdown?: Json
          created_at?: string
          id?: string
          input_payload?: Json
          labour_hours: number
          position: number
          requires_license?: boolean
          service_id: string
          total_price: number
        }
        Update: {
          booking_id?: string
          breakdown?: Json
          created_at?: string
          id?: string
          input_payload?: Json
          labour_hours?: number
          position?: number
          requires_license?: boolean
          service_id?: string
          total_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_manual_declarations: {
        Row: {
          accepted_at: string
          booking_id: string | null
          client_id: string
          created_at: string
          declaration_id: string
          declared_variables: Json
          id: string
          input_source: string
          legal_text_hash: string
          legal_text_version: string
          service_id: string | null
          service_name: string | null
        }
        Insert: {
          accepted_at?: string
          booking_id?: string | null
          client_id: string
          created_at?: string
          declaration_id: string
          declared_variables?: Json
          id?: string
          input_source?: string
          legal_text_hash: string
          legal_text_version: string
          service_id?: string | null
          service_name?: string | null
        }
        Update: {
          accepted_at?: string
          booking_id?: string | null
          client_id?: string
          created_at?: string
          declaration_id?: string
          declared_variables?: Json
          id?: string
          input_source?: string
          legal_text_hash?: string
          legal_text_version?: string
          service_id?: string | null
          service_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_manual_declarations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_manual_declarations_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_media: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          media_type: string
          media_url: string | null
          storage_bucket: string | null
          storage_path: string | null
          uploader_id: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          media_type?: string
          media_url?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          uploader_id?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          media_type?: string
          media_url?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          uploader_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_media_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_payment_attempts: {
        Row: {
          availability_snapshot: Json
          booking_id: string | null
          cancelled_at: string | null
          client_id: string
          confirmed_at: string | null
          created_at: string
          currency: string
          duration_hours: number
          economic_snapshot: Json
          end_date: string | null
          expired_at: string | null
          failed_at: string | null
          gardener_id: string
          gateway_response: Json
          id: string
          labour_hours: number | null
          last_error_code: string | null
          last_error_message: string | null
          last_webhook_event_id: string | null
          metadata_snapshot: Json
          payable_now_amount_cents: number
          payment_expires_at: string | null
          pricing_snapshot: Json
          quote_id: string
          quote_signature: string
          selected_date: string
          selected_start_time: string
          service_id: string
          service_total_amount_cents: number
          status: string
          stripe_idempotency_key: string
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          availability_snapshot?: Json
          booking_id?: string | null
          cancelled_at?: string | null
          client_id: string
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          duration_hours: number
          economic_snapshot?: Json
          end_date?: string | null
          expired_at?: string | null
          failed_at?: string | null
          gardener_id: string
          gateway_response?: Json
          id?: string
          labour_hours?: number | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_webhook_event_id?: string | null
          metadata_snapshot?: Json
          payable_now_amount_cents: number
          payment_expires_at?: string | null
          pricing_snapshot?: Json
          quote_id: string
          quote_signature: string
          selected_date: string
          selected_start_time: string
          service_id: string
          service_total_amount_cents: number
          status?: string
          stripe_idempotency_key: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          availability_snapshot?: Json
          booking_id?: string | null
          cancelled_at?: string | null
          client_id?: string
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          duration_hours?: number
          economic_snapshot?: Json
          end_date?: string | null
          expired_at?: string | null
          failed_at?: string | null
          gardener_id?: string
          gateway_response?: Json
          id?: string
          labour_hours?: number | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_webhook_event_id?: string | null
          metadata_snapshot?: Json
          payable_now_amount_cents?: number
          payment_expires_at?: string | null
          pricing_snapshot?: Json
          quote_id?: string
          quote_signature?: string
          selected_date?: string
          selected_start_time?: string
          service_id?: string
          service_total_amount_cents?: number
          status?: string
          stripe_idempotency_key?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_payment_attempts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_payment_attempts_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "booking_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_payment_attempts_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_quotes: {
        Row: {
          availability_snapshot: Json
          booking_id: string | null
          client_id: string | null
          client_latitude: number | null
          client_longitude: number | null
          consumed_at: string | null
          economic_snapshot: Json
          estimated_hours: number
          expires_at: string
          gardener_id: string
          generated_at: string
          id: string
          input_payload: Json
          items: Json | null
          pricing_snapshot: Json
          pricing_version: string
          provider_config_version: string
          provider_latitude: number | null
          provider_longitude: number | null
          selected_date: string | null
          selected_start_time: string | null
          service_id: string
          signature: string
          status: string
          total_price: number
        }
        Insert: {
          availability_snapshot?: Json
          booking_id?: string | null
          client_id?: string | null
          client_latitude?: number | null
          client_longitude?: number | null
          consumed_at?: string | null
          economic_snapshot?: Json
          estimated_hours: number
          expires_at: string
          gardener_id: string
          generated_at?: string
          id?: string
          input_payload?: Json
          items?: Json | null
          pricing_snapshot?: Json
          pricing_version: string
          provider_config_version: string
          provider_latitude?: number | null
          provider_longitude?: number | null
          selected_date?: string | null
          selected_start_time?: string | null
          service_id: string
          signature: string
          status?: string
          total_price: number
        }
        Update: {
          availability_snapshot?: Json
          booking_id?: string | null
          client_id?: string | null
          client_latitude?: number | null
          client_longitude?: number | null
          consumed_at?: string | null
          economic_snapshot?: Json
          estimated_hours?: number
          expires_at?: string
          gardener_id?: string
          generated_at?: string
          id?: string
          input_payload?: Json
          items?: Json | null
          pricing_snapshot?: Json
          pricing_version?: string
          provider_config_version?: string
          provider_latitude?: number | null
          provider_longitude?: number | null
          selected_date?: string | null
          selected_start_time?: string | null
          service_id?: string
          signature?: string
          status?: string
          total_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_quotes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_quotes_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_requests: {
        Row: {
          accepted_by: string | null
          client_address: string
          client_id: string | null
          created_at: string | null
          date: string
          duration_hours: number
          expires_at: string | null
          id: string
          notes: string | null
          service_id: string | null
          start_hour: number
          status: string | null
          updated_at: string | null
        }
        Insert: {
          accepted_by?: string | null
          client_address: string
          client_id?: string | null
          created_at?: string | null
          date: string
          duration_hours: number
          expires_at?: string | null
          id?: string
          notes?: string | null
          service_id?: string | null
          start_hour: number
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          accepted_by?: string | null
          client_address?: string
          client_id?: string | null
          created_at?: string | null
          date?: string
          duration_hours?: number
          expires_at?: string | null
          id?: string
          notes?: string | null
          service_id?: string | null
          start_hour?: number
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_requests_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_responses: {
        Row: {
          created_at: string | null
          gardener_id: string | null
          id: string
          message: string | null
          request_id: string | null
          response_type: string
          suggested_date: string | null
          suggested_start_hour: number | null
        }
        Insert: {
          created_at?: string | null
          gardener_id?: string | null
          id?: string
          message?: string | null
          request_id?: string | null
          response_type: string
          suggested_date?: string | null
          suggested_start_hour?: number | null
        }
        Update: {
          created_at?: string | null
          gardener_id?: string | null
          id?: string
          message?: string | null
          request_id?: string | null
          response_type?: string
          suggested_date?: string | null
          suggested_start_hour?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_responses_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "booking_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_rpc_idempotency: {
        Row: {
          action: string
          actor_id: string
          booking_id: string
          completed_at: string | null
          created_at: string
          operation_id: string
          payload_signature: string
          response_payload: Json | null
        }
        Insert: {
          action: string
          actor_id: string
          booking_id: string
          completed_at?: string | null
          created_at?: string
          operation_id: string
          payload_signature: string
          response_payload?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string
          booking_id?: string
          completed_at?: string | null
          created_at?: string
          operation_id?: string
          payload_signature?: string
          response_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_rpc_idempotency_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_schedule_hold_blocks: {
        Row: {
          created_at: string
          date: string
          gardener_id: string
          hold_id: string
          hour_block: number
        }
        Insert: {
          created_at?: string
          date: string
          gardener_id: string
          hold_id: string
          hour_block: number
        }
        Update: {
          created_at?: string
          date?: string
          gardener_id?: string
          hold_id?: string
          hour_block?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_schedule_hold_blocks_hold_id_fkey"
            columns: ["hold_id"]
            isOneToOne: false
            referencedRelation: "booking_schedule_holds"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_schedule_holds: {
        Row: {
          assignee_id: string | null
          booking_id: string | null
          client_id: string
          created_at: string
          duration_hours: number
          expires_at: string
          gardener_id: string
          id: string
          payment_attempt_id: string
          quote_id: string
          release_reason: string | null
          released_at: string | null
          selected_date: string
          selected_start_time: string
          service_id: string
          status: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          booking_id?: string | null
          client_id: string
          created_at?: string
          duration_hours: number
          expires_at: string
          gardener_id: string
          id?: string
          payment_attempt_id: string
          quote_id: string
          release_reason?: string | null
          released_at?: string | null
          selected_date: string
          selected_start_time: string
          service_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          booking_id?: string | null
          client_id?: string
          created_at?: string
          duration_hours?: number
          expires_at?: string
          gardener_id?: string
          id?: string
          payment_attempt_id?: string
          quote_id?: string
          release_reason?: string | null
          released_at?: string | null
          selected_date?: string
          selected_start_time?: string
          service_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_schedule_holds_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_schedule_holds_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: true
            referencedRelation: "booking_payment_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_schedule_holds_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "booking_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_schedule_holds_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_variable_revisions: {
        Row: {
          author_id: string | null
          author_role: string
          booking_id: string
          corrected_variables: Json | null
          created_at: string
          id: string
          original_total_price: number | null
          original_variables: Json | null
          proposed_total_price: number | null
          reason: string | null
        }
        Insert: {
          author_id?: string | null
          author_role: string
          booking_id: string
          corrected_variables?: Json | null
          created_at?: string
          id?: string
          original_total_price?: number | null
          original_variables?: Json | null
          proposed_total_price?: number | null
          reason?: string | null
        }
        Update: {
          author_id?: string | null
          author_role?: string
          booking_id?: string
          corrected_variables?: Json | null
          created_at?: string
          id?: string
          original_total_price?: number | null
          original_variables?: Json | null
          proposed_total_price?: number | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_variable_revisions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          assignment_pending: boolean
          auto_completed_at: string | null
          buffer_applied: boolean | null
          cancellation_actor: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_address: string
          client_confirmed_at: string | null
          client_confirmed_via: string | null
          client_id: string | null
          client_latitude: number | null
          client_longitude: number | null
          client_total_price: number | null
          confirmation_deadline_at: string | null
          confirmation_prompt_attempts: number
          confirmation_prompt_due_at: string | null
          confirmation_prompt_sent_at: string | null
          confirmation_prompt_state: string
          created_at: string | null
          data_input_mode: string | null
          date: string
          duration_hours: number
          end_date: string | null
          end_time: string | null
          gardener_finished_at: string | null
          gardener_id: string | null
          hourly_rate: number | null
          id: string
          labour_hours: number | null
          management_fee: number
          management_fee_source: string
          manual_declaration_id: string | null
          no_show_reported_at: string | null
          no_show_reported_by: string | null
          notes: string | null
          price_change_status: string | null
          pricing_context: Json
          proposed_date: string | null
          proposed_duration_hours: number | null
          proposed_price_at: string | null
          proposed_price_by: string | null
          proposed_price_expires_at: string | null
          proposed_price_reason: string | null
          proposed_start_time: string | null
          proposed_total_price: number | null
          provider_latitude: number | null
          provider_longitude: number | null
          request_id: string | null
          reschedule_answer_notified_at: string | null
          reschedule_expires_at: string | null
          reschedule_proposal_notified_at: string | null
          reschedule_proposed_at: string | null
          reschedule_reason: string | null
          reschedule_status: string
          service_id: string | null
          start_time: string
          status: string | null
          total_price: number
          travel_fee: number | null
          updated_at: string | null
        }
        Insert: {
          assignment_pending?: boolean
          auto_completed_at?: string | null
          buffer_applied?: boolean | null
          cancellation_actor?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_address: string
          client_confirmed_at?: string | null
          client_confirmed_via?: string | null
          client_id?: string | null
          client_latitude?: number | null
          client_longitude?: number | null
          client_total_price?: number | null
          confirmation_deadline_at?: string | null
          confirmation_prompt_attempts?: number
          confirmation_prompt_due_at?: string | null
          confirmation_prompt_sent_at?: string | null
          confirmation_prompt_state?: string
          created_at?: string | null
          data_input_mode?: string | null
          date: string
          duration_hours: number
          end_date?: string | null
          end_time?: string | null
          gardener_finished_at?: string | null
          gardener_id?: string | null
          hourly_rate?: number | null
          id?: string
          labour_hours?: number | null
          management_fee: number
          management_fee_source: string
          manual_declaration_id?: string | null
          no_show_reported_at?: string | null
          no_show_reported_by?: string | null
          notes?: string | null
          price_change_status?: string | null
          pricing_context?: Json
          proposed_date?: string | null
          proposed_duration_hours?: number | null
          proposed_price_at?: string | null
          proposed_price_by?: string | null
          proposed_price_expires_at?: string | null
          proposed_price_reason?: string | null
          proposed_start_time?: string | null
          proposed_total_price?: number | null
          provider_latitude?: number | null
          provider_longitude?: number | null
          request_id?: string | null
          reschedule_answer_notified_at?: string | null
          reschedule_expires_at?: string | null
          reschedule_proposal_notified_at?: string | null
          reschedule_proposed_at?: string | null
          reschedule_reason?: string | null
          reschedule_status?: string
          service_id?: string | null
          start_time: string
          status?: string | null
          total_price: number
          travel_fee?: number | null
          updated_at?: string | null
        }
        Update: {
          assignment_pending?: boolean
          auto_completed_at?: string | null
          buffer_applied?: boolean | null
          cancellation_actor?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_address?: string
          client_confirmed_at?: string | null
          client_confirmed_via?: string | null
          client_id?: string | null
          client_latitude?: number | null
          client_longitude?: number | null
          client_total_price?: number | null
          confirmation_deadline_at?: string | null
          confirmation_prompt_attempts?: number
          confirmation_prompt_due_at?: string | null
          confirmation_prompt_sent_at?: string | null
          confirmation_prompt_state?: string
          created_at?: string | null
          data_input_mode?: string | null
          date?: string
          duration_hours?: number
          end_date?: string | null
          end_time?: string | null
          gardener_finished_at?: string | null
          gardener_id?: string | null
          hourly_rate?: number | null
          id?: string
          labour_hours?: number | null
          management_fee?: number
          management_fee_source?: string
          manual_declaration_id?: string | null
          no_show_reported_at?: string | null
          no_show_reported_by?: string | null
          notes?: string | null
          price_change_status?: string | null
          pricing_context?: Json
          proposed_date?: string | null
          proposed_duration_hours?: number | null
          proposed_price_at?: string | null
          proposed_price_by?: string | null
          proposed_price_expires_at?: string | null
          proposed_price_reason?: string | null
          proposed_start_time?: string | null
          proposed_total_price?: number | null
          provider_latitude?: number | null
          provider_longitude?: number | null
          request_id?: string | null
          reschedule_answer_notified_at?: string | null
          reschedule_expires_at?: string | null
          reschedule_proposal_notified_at?: string | null
          reschedule_proposed_at?: string | null
          reschedule_reason?: string | null
          reschedule_status?: string
          service_id?: string | null
          start_time?: string
          status?: string | null
          total_price?: number
          travel_fee?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          booking_id: string | null
          created_at: string | null
          id: string
          image_url: string | null
          message: string
          message_type: string
          read_at: string | null
          read_by: string | null
          sender_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          message: string
          message_type?: string
          read_at?: string | null
          read_by?: string | null
          sender_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          message?: string
          message_type?: string
          read_at?: string | null
          read_by?: string | null
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_thread_reads: {
        Row: {
          booking_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          booking_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          booking_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_thread_reads_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          allow_split_jobs: boolean
          assignment_mode: string
          created_at: string
          id: string
          legal_name: string | null
          logo_url: string | null
          max_crew: number
          provider_user_id: string
          status: string
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          allow_split_jobs?: boolean
          assignment_mode?: string
          created_at?: string
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          max_crew?: number
          provider_user_id: string
          status?: string
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          allow_split_jobs?: boolean
          assignment_mode?: string
          created_at?: string
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          max_crew?: number
          provider_user_id?: string
          status?: string
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_provider_user_id_fkey"
            columns: ["provider_user_id"]
            isOneToOne: true
            referencedRelation: "gardener_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "companies_provider_user_id_fkey"
            columns: ["provider_user_id"]
            isOneToOne: true
            referencedRelation: "public_gardener_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      company_applications: {
        Row: {
          accept_terms: boolean
          address: string | null
          answers: Json
          city_zone: string | null
          commercial_name: string | null
          contact_name: string | null
          created_at: string
          declaration_truth: boolean
          email: string | null
          id: string
          legal_name: string | null
          logo_url: string | null
          owner_works: boolean
          phone: string | null
          proof_photos: string[]
          review_comment: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          services: string[]
          status: string
          submitted_at: string | null
          tax_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accept_terms?: boolean
          address?: string | null
          answers?: Json
          city_zone?: string | null
          commercial_name?: string | null
          contact_name?: string | null
          created_at?: string
          declaration_truth?: boolean
          email?: string | null
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          owner_works?: boolean
          phone?: string | null
          proof_photos?: string[]
          review_comment?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          services?: string[]
          status?: string
          submitted_at?: string | null
          tax_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accept_terms?: boolean
          address?: string | null
          answers?: Json
          city_zone?: string | null
          commercial_name?: string | null
          contact_name?: string | null
          created_at?: string
          declaration_truth?: boolean
          email?: string | null
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          owner_works?: boolean
          phone?: string | null
          proof_photos?: string[]
          review_comment?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          services?: string[]
          status?: string
          submitted_at?: string | null
          tax_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      company_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          company_id: string
          created_at: string
          created_by: string
          email: string
          email_sent_at: string | null
          expires_at: string
          id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id: string
          created_at?: string
          created_by: string
          email: string
          email_sent_at?: string | null
          expires_at: string
          id?: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          email?: string
          email_sent_at?: string | null
          expires_at?: string
          id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_member_services: {
        Row: {
          created_at: string
          member_id: string
          service_id: string
        }
        Insert: {
          created_at?: string
          member_id: string
          service_id: string
        }
        Update: {
          created_at?: string
          member_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_member_services_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "company_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_member_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          counts_as_labour: boolean
          id: string
          joined_at: string
          left_at: string | null
          role: string
          status: string
          user_id: string
        }
        Insert: {
          company_id: string
          counts_as_labour?: boolean
          id?: string
          joined_at?: string
          left_at?: string | null
          role?: string
          status?: string
          user_id: string
        }
        Update: {
          company_id?: string
          counts_as_labour?: boolean
          id?: string
          joined_at?: string
          left_at?: string | null
          role?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      gardener_applications: {
        Row: {
          accept_terms: boolean | null
          can_prove: boolean | null
          certification_photos: string[] | null
          certification_text: string | null
          city_zone: string | null
          created_at: string | null
          declaration_truth: boolean | null
          email: string | null
          experience_description: string | null
          experience_range: string | null
          experience_years: number | null
          full_name: string | null
          id: string
          other_services: string | null
          phone: string | null
          professional_photo_url: string | null
          proof_photos: string[] | null
          review_comment: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          services: string[] | null
          status: string | null
          submitted_at: string | null
          test_grass_frequency: string | null
          test_hedge_season: string | null
          test_pest_action: string | null
          tools_available: string[] | null
          updated_at: string | null
          user_id: string | null
          worked_for_companies: boolean | null
        }
        Insert: {
          accept_terms?: boolean | null
          can_prove?: boolean | null
          certification_photos?: string[] | null
          certification_text?: string | null
          city_zone?: string | null
          created_at?: string | null
          declaration_truth?: boolean | null
          email?: string | null
          experience_description?: string | null
          experience_range?: string | null
          experience_years?: number | null
          full_name?: string | null
          id?: string
          other_services?: string | null
          phone?: string | null
          professional_photo_url?: string | null
          proof_photos?: string[] | null
          review_comment?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          services?: string[] | null
          status?: string | null
          submitted_at?: string | null
          test_grass_frequency?: string | null
          test_hedge_season?: string | null
          test_pest_action?: string | null
          tools_available?: string[] | null
          updated_at?: string | null
          user_id?: string | null
          worked_for_companies?: boolean | null
        }
        Update: {
          accept_terms?: boolean | null
          can_prove?: boolean | null
          certification_photos?: string[] | null
          certification_text?: string | null
          city_zone?: string | null
          created_at?: string | null
          declaration_truth?: boolean | null
          email?: string | null
          experience_description?: string | null
          experience_range?: string | null
          experience_years?: number | null
          full_name?: string | null
          id?: string
          other_services?: string | null
          phone?: string | null
          professional_photo_url?: string | null
          proof_photos?: string[] | null
          review_comment?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          services?: string[] | null
          status?: string | null
          submitted_at?: string | null
          test_grass_frequency?: string | null
          test_hedge_season?: string | null
          test_pest_action?: string | null
          tools_available?: string[] | null
          updated_at?: string | null
          user_id?: string | null
          worked_for_companies?: boolean | null
        }
        Relationships: []
      }
      gardener_licenses: {
        Row: {
          created_at: string | null
          document_hash: string | null
          document_url: string
          expires_at: string | null
          gardener_id: string | null
          id: string
          license_number: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          terms_accepted: boolean | null
          terms_accepted_at: string | null
        }
        Insert: {
          created_at?: string | null
          document_hash?: string | null
          document_url: string
          expires_at?: string | null
          gardener_id?: string | null
          id?: string
          license_number?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          terms_accepted?: boolean | null
          terms_accepted_at?: string | null
        }
        Update: {
          created_at?: string | null
          document_hash?: string | null
          document_url?: string
          expires_at?: string | null
          gardener_id?: string | null
          id?: string
          license_number?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          terms_accepted?: boolean | null
          terms_accepted_at?: string | null
        }
        Relationships: []
      }
      gardener_profiles: {
        Row: {
          accept_terms: boolean | null
          address: string
          avatar_url: string | null
          can_prove: boolean | null
          certification_photos: string[] | null
          certification_text: string | null
          city_zone: string | null
          created_at: string | null
          declaration_truth: boolean | null
          description: string | null
          experience_description: string | null
          experience_range: string | null
          experience_years: number | null
          flyer_generated_at: string | null
          full_name: string
          has_phytosanitary_license: boolean | null
          id: string
          is_available: boolean | null
          license_expires_at: string | null
          license_verification_status: string | null
          license_verified_at: string | null
          max_distance: number | null
          operational_latitude: number | null
          operational_longitude: number | null
          other_services: string | null
          phone: string
          professional_photo_url: string | null
          promotional_flyer_url: string | null
          proof_photos: string[] | null
          provider_kind: string
          rating: number | null
          rating_average: number | null
          rating_count: number | null
          services: string[] | null
          test_grass_frequency: string | null
          test_hedge_season: string | null
          test_pest_action: string | null
          tools_available: string[] | null
          total_reviews: number | null
          updated_at: string | null
          user_id: string | null
          worked_for_companies: boolean | null
        }
        Insert: {
          accept_terms?: boolean | null
          address: string
          avatar_url?: string | null
          can_prove?: boolean | null
          certification_photos?: string[] | null
          certification_text?: string | null
          city_zone?: string | null
          created_at?: string | null
          declaration_truth?: boolean | null
          description?: string | null
          experience_description?: string | null
          experience_range?: string | null
          experience_years?: number | null
          flyer_generated_at?: string | null
          full_name: string
          has_phytosanitary_license?: boolean | null
          id?: string
          is_available?: boolean | null
          license_expires_at?: string | null
          license_verification_status?: string | null
          license_verified_at?: string | null
          max_distance?: number | null
          operational_latitude?: number | null
          operational_longitude?: number | null
          other_services?: string | null
          phone: string
          professional_photo_url?: string | null
          promotional_flyer_url?: string | null
          proof_photos?: string[] | null
          provider_kind?: string
          rating?: number | null
          rating_average?: number | null
          rating_count?: number | null
          services?: string[] | null
          test_grass_frequency?: string | null
          test_hedge_season?: string | null
          test_pest_action?: string | null
          tools_available?: string[] | null
          total_reviews?: number | null
          updated_at?: string | null
          user_id?: string | null
          worked_for_companies?: boolean | null
        }
        Update: {
          accept_terms?: boolean | null
          address?: string
          avatar_url?: string | null
          can_prove?: boolean | null
          certification_photos?: string[] | null
          certification_text?: string | null
          city_zone?: string | null
          created_at?: string | null
          declaration_truth?: boolean | null
          description?: string | null
          experience_description?: string | null
          experience_range?: string | null
          experience_years?: number | null
          flyer_generated_at?: string | null
          full_name?: string
          has_phytosanitary_license?: boolean | null
          id?: string
          is_available?: boolean | null
          license_expires_at?: string | null
          license_verification_status?: string | null
          license_verified_at?: string | null
          max_distance?: number | null
          operational_latitude?: number | null
          operational_longitude?: number | null
          other_services?: string | null
          phone?: string
          professional_photo_url?: string | null
          promotional_flyer_url?: string | null
          proof_photos?: string[] | null
          provider_kind?: string
          rating?: number | null
          rating_average?: number | null
          rating_count?: number | null
          services?: string[] | null
          test_grass_frequency?: string | null
          test_hedge_season?: string | null
          test_pest_action?: string | null
          tools_available?: string[] | null
          total_reviews?: number | null
          updated_at?: string | null
          user_id?: string | null
          worked_for_companies?: boolean | null
        }
        Relationships: []
      }
      gardener_service_prices: {
        Row: {
          active: boolean
          additional_config: Json | null
          created_at: string | null
          currency: string
          gardener_id: string
          price_per_unit: number
          service_id: string
          unit_type: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          additional_config?: Json | null
          created_at?: string | null
          currency?: string
          gardener_id: string
          price_per_unit: number
          service_id: string
          unit_type: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          additional_config?: Json | null
          created_at?: string | null
          currency?: string
          gardener_id?: string
          price_per_unit?: number
          service_id?: string
          unit_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gardener_service_prices_gardener_id_fkey"
            columns: ["gardener_id"]
            isOneToOne: false
            referencedRelation: "gardener_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "gardener_service_prices_gardener_id_fkey"
            columns: ["gardener_id"]
            isOneToOne: false
            referencedRelation: "public_gardener_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "gardener_service_prices_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          created_at: string | null
          full_name: string | null
          id: string
          phone: string | null
          role: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      recurring_availability_settings: {
        Row: {
          gardener_id: string
          last_generated_date: string | null
          min_notice_hours: number | null
          updated_at: string | null
          weeks_to_maintain: number | null
        }
        Insert: {
          gardener_id: string
          last_generated_date?: string | null
          min_notice_hours?: number | null
          updated_at?: string | null
          weeks_to_maintain?: number | null
        }
        Update: {
          gardener_id?: string
          last_generated_date?: string | null
          min_notice_hours?: number | null
          updated_at?: string | null
          weeks_to_maintain?: number | null
        }
        Relationships: []
      }
      recurring_schedules: {
        Row: {
          created_at: string | null
          day_of_week: number
          end_time: string
          gardener_id: string | null
          id: string
          start_time: string
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          end_time: string
          gardener_id?: string | null
          id?: string
          start_time: string
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          gardener_id?: string | null
          id?: string
          start_time?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          booking_id: string | null
          client_id: string | null
          comment: string | null
          created_at: string | null
          gardener_id: string | null
          gardener_response: string | null
          gardener_response_at: string | null
          hidden_at: string | null
          hidden_reason: string | null
          id: string
          is_system_penalty: boolean
          rating: number
          system_reason: string | null
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          client_id?: string | null
          comment?: string | null
          created_at?: string | null
          gardener_id?: string | null
          gardener_response?: string | null
          gardener_response_at?: string | null
          hidden_at?: string | null
          hidden_reason?: string | null
          id?: string
          is_system_penalty?: boolean
          rating: number
          system_reason?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          client_id?: string | null
          comment?: string | null
          created_at?: string | null
          gardener_id?: string | null
          gardener_response?: string | null
          gardener_response_at?: string | null
          hidden_at?: string | null
          hidden_reason?: string | null
          id?: string
          is_system_penalty?: boolean
          rating?: number
          system_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      role_logs: {
        Row: {
          action: string
          created_at: string | null
          details: string | null
          id: string
          metadata: Json | null
          new_role: string | null
          old_role: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: string | null
          id?: string
          metadata?: Json | null
          new_role?: string | null
          old_role?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: string | null
          id?: string
          metadata?: Json | null
          new_role?: string | null
          old_role?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      service_images: {
        Row: {
          active: boolean | null
          created_at: string
          id: string
          image_url: string
          service_id: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string
          id?: string
          image_url: string
          service_id?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string
          id?: string
          image_url?: string
          service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_images_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: true
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string | null
          description: string
          hourly_rate: number | null
          icon: string | null
          id: string
          image_id: string | null
          is_active: boolean | null
          measurement: string | null
          name: string
          pricing_method: string | null
          required_by_services: string[] | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          description: string
          hourly_rate?: number | null
          icon?: string | null
          id?: string
          image_id?: string | null
          is_active?: boolean | null
          measurement?: string | null
          name: string
          pricing_method?: string | null
          required_by_services?: string[] | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string
          hourly_rate?: number | null
          icon?: string | null
          id?: string
          image_id?: string | null
          is_active?: boolean | null
          measurement?: string | null
          name?: string
          pricing_method?: string | null
          required_by_services?: string[] | null
          status?: string | null
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          event_type: string
          failure_message: string | null
          payload: Json
          payment_attempt_id: string | null
          processed_at: string | null
          received_at: string
          status: string
          stripe_event_id: string
          stripe_object_id: string | null
        }
        Insert: {
          event_type: string
          failure_message?: string | null
          payload?: Json
          payment_attempt_id?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
          stripe_event_id: string
          stripe_object_id?: string | null
        }
        Update: {
          event_type?: string
          failure_message?: string | null
          payload?: Json
          payment_attempt_id?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
          stripe_event_id?: string
          stripe_object_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stripe_webhook_events_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "booking_payment_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_chats: {
        Row: {
          client_id: string | null
          created_at: string | null
          gardener_id: string | null
          id: string
          request_id: string | null
          status: string | null
          suggested_date: string | null
          suggested_duration_hours: number | null
          suggested_start_hour: number | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          gardener_id?: string | null
          id?: string
          request_id?: string | null
          status?: string | null
          suggested_date?: string | null
          suggested_duration_hours?: number | null
          suggested_start_hour?: number | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          gardener_id?: string | null
          id?: string
          request_id?: string | null
          status?: string | null
          suggested_date?: string | null
          suggested_duration_hours?: number | null
          suggested_start_hour?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_chats_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "booking_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_messages: {
        Row: {
          chat_id: string | null
          created_at: string | null
          id: string
          message: string
          message_type: string | null
          sender_id: string | null
        }
        Insert: {
          chat_id?: string | null
          created_at?: string | null
          id?: string
          message: string
          message_type?: string | null
          sender_id?: string | null
        }
        Update: {
          chat_id?: string | null
          created_at?: string | null
          id?: string
          message?: string
          message_type?: string | null
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "suggestion_chats"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      public_gardener_directory: {
        Row: {
          avatar_url: string | null
          description: string | null
          full_name: string | null
          has_phytosanitary_license: boolean | null
          is_available: boolean | null
          max_distance: number | null
          provider_kind: string | null
          rating: number | null
          rating_average: number | null
          rating_count: number | null
          services: string[] | null
          total_reviews: number | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          description?: string | null
          full_name?: string | null
          has_phytosanitary_license?: boolean | null
          is_available?: boolean | null
          max_distance?: number | null
          provider_kind?: string | null
          rating?: number | null
          rating_average?: number | null
          rating_count?: number | null
          services?: string[] | null
          total_reviews?: number | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          description?: string | null
          full_name?: string | null
          has_phytosanitary_license?: boolean | null
          is_available?: boolean | null
          max_distance?: number | null
          provider_kind?: string | null
          rating?: number | null
          rating_average?: number | null
          rating_count?: number | null
          services?: string[] | null
          total_reviews?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      public_gardener_reviews: {
        Row: {
          author_display_name: string | null
          booking_id: string | null
          comment: string | null
          created_at: string | null
          gardener_id: string | null
          gardener_response: string | null
          gardener_response_at: string | null
          id: string | null
          is_system_penalty: boolean | null
          rating: number | null
          service_name: string | null
          system_reason: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_company_invitation: { Args: { p_token: string }; Returns: Json }
      admin_review_company_application: {
        Args: { p_application_id: string; p_comment?: string; p_status: string }
        Returns: Json
      }
      admin_review_gardener_application: {
        Args: { p_application_id: string; p_comment?: string; p_status: string }
        Returns: undefined
      }
      assign_booking_hours: {
        Args: { p_booking_id: string; p_workers: string[] }
        Returns: Json
      }
      assign_booking_worker: {
        Args: { p_booking_id: string; p_worker_id: string }
        Returns: Json
      }
      attach_manual_declaration_to_booking: {
        Args: { p_booking_id: string; p_declaration_id: string }
        Returns: undefined
      }
      auto_complete_due_bookings: { Args: never; Returns: number }
      booking_assignment_candidates: {
        Args: { p_booking_id: string }
        Returns: {
          full_name: string
          is_current: boolean
          is_free: boolean
          user_id: string
        }[]
      }
      booking_hour_options: {
        Args: { p_booking_id: string }
        Returns: {
          current_hours: number[]
          free_hours: number[]
          full_name: string
          user_id: string
        }[]
      }
      booking_replace_candidates: {
        Args: { p_booking_id: string; p_from: string }
        Returns: {
          full_name: string
          is_free: boolean
          user_id: string
        }[]
      }
      booking_replan_cells: {
        Args: { p_booking_id: string; p_date: string; p_start_hour: number }
        Returns: {
          date: string
          hour_block: number
          worker_id: string
        }[]
      }
      booking_requires_phyto_license: {
        Args: { p_booking_id: string }
        Returns: boolean
      }
      booking_service_end: {
        Args: { p_booking: Database["public"]["Tables"]["bookings"]["Row"] }
        Returns: string
      }
      booking_service_ids: { Args: { p_booking_id: string }; Returns: string[] }
      booking_service_label: { Args: { p_booking_id: string }; Returns: string }
      booking_service_start: {
        Args: { p_booking: Database["public"]["Tables"]["bookings"]["Row"] }
        Returns: string
      }
      booking_slot_workers: {
        Args: { p_booking_id: string; p_date: string; p_start_hour: number }
        Returns: string[]
      }
      booking_worker_for_client: {
        Args: { p_booking_id: string }
        Returns: Json
      }
      can_read_booking_items: {
        Args: { p_booking_id: string }
        Returns: boolean
      }
      can_read_company_member: {
        Args: { p_member_id: string }
        Returns: boolean
      }
      cancel_booking: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: Json
      }
      chat_display_name: {
        Args: { p_fallback: string; p_user_id: string }
        Returns: string
      }
      chat_overview: {
        Args: never
        Returns: {
          booking_id: string
          last_message: string
          last_message_at: string
          last_message_has_image: boolean
          last_message_type: string
          unread_count: number
        }[]
      }
      claim_due_confirmation_prompts: {
        Args: { p_limit?: number }
        Returns: string[]
      }
      cleanup_expired_booking_payment_state: {
        Args: {
          p_end_date?: string
          p_gardener_ids?: string[]
          p_start_date?: string
        }
        Returns: Json
      }
      cleanup_expired_requests: { Args: never; Returns: undefined }
      company_schedule: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      company_team_overview: { Args: never; Returns: Json }
      complete_booking_batch_operation: {
        Args: {
          p_action: string
          p_operation_id: string
          p_response_payload: Json
        }
        Returns: undefined
      }
      complete_booking_operation: {
        Args: {
          p_action: string
          p_operation_id: string
          p_response_payload: Json
        }
        Returns: undefined
      }
      confirm_booking_payment_attempt: {
        Args: {
          p_amount_total_cents: number
          p_attempt_id: string
          p_currency?: string
          p_gateway_payload?: Json
          p_stripe_event_id: string
          p_stripe_payment_intent_id: string
        }
        Returns: Json
      }
      confirm_booking_service: { Args: { p_booking_id: string }; Returns: Json }
      consume_ai_analysis_quota: {
        Args: { p_max_requests?: number; p_subject: string; p_window?: string }
        Returns: Json
      }
      consume_ai_pricing_quota: {
        Args: { p_max_requests?: number; p_user_id: string; p_window?: string }
        Returns: Json
      }
      count_distinct_available_legacy_hours: {
        Args: {
          p_date: string
          p_end_hour: number
          p_gardener_id: string
          p_start_hour: number
        }
        Returns: number
      }
      create_atomic_booking: {
        Args: {
          p_booking_id?: string
          p_client_address: string
          p_date: string
          p_duration_hours: number
          p_gardener_id: string
          p_hourly_rate?: number
          p_notes?: string
          p_operation_id?: string
          p_pricing_context?: Json
          p_quote_id?: string
          p_service_id: string
          p_start_time: string
          p_total_price: number
          p_travel_fee?: number
        }
        Returns: Json
      }
      create_broadcast_booking_requests: {
        Args: {
          p_client_address: string
          p_date: string
          p_duration_hours: number
          p_gardener_ids: string[]
          p_hourly_rate?: number
          p_notes?: string
          p_operation_id?: string
          p_pricing_context?: Json
          p_service_id: string
          p_start_time: string
          p_total_price: number
          p_travel_fee?: number
        }
        Returns: Json
      }
      create_company_invitation: { Args: { p_email: string }; Returns: Json }
      current_account_role: { Args: never; Returns: string }
      deactivate_company_member: {
        Args: { p_member_id: string }
        Returns: Json
      }
      expire_due_booking_requests: { Args: never; Returns: number }
      expire_due_phytosanitary_licenses: { Args: never; Returns: number }
      expire_pending_price_change: {
        Args: { p_booking_id: string }
        Returns: boolean
      }
      expire_stale_booking_requests: {
        Args: { p_gardener_id?: string }
        Returns: number
      }
      format_eur: { Args: { p_value: number }; Returns: string }
      free_run: { Args: { p_from: number; p_hours: number[] }; Returns: number }
      generate_recurring_slots: {
        Args: { force_regenerate?: boolean; target_gardener_id: string }
        Returns: undefined
      }
      get_booking_payment_attempt_summary: {
        Args: { p_attempt_id: string }
        Returns: Json
      }
      get_booking_service_details: {
        Args: { p_booking_id: string }
        Returns: Json
      }
      get_rebook_payload: { Args: { p_booking_id: string }; Returns: Json }
      has_valid_phyto_license: { Args: { p_user_id: string }; Returns: boolean }
      invitation_preview: { Args: { p_token: string }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      is_booking_assignee: { Args: { p_booking_id: string }; Returns: boolean }
      is_company_member: { Args: { p_company_id: string }; Returns: boolean }
      is_company_owner: { Args: { p_company_id: string }; Returns: boolean }
      is_my_team_member: { Args: { p_user_id: string }; Returns: boolean }
      issue_booking_confirmation_token: {
        Args: {
          p_booking_id: string
          p_expires_at: string
          p_token_hash: string
        }
        Returns: string
      }
      lifecycle_tick_setting: { Args: { p_name: string }; Returns: string }
      list_bookings_pending_payment_reconciliation: {
        Args: { p_limit?: number }
        Returns: {
          attempt_id: string
          booking_id: string
          booking_status: string
          desired_action: string
          payment_intent_id: string
        }[]
      }
      mark_booking_payment_settled: {
        Args: { p_attempt_id: string; p_result: string }
        Returns: undefined
      }
      mark_company_invitation_emailed: {
        Args: { p_caller: string; p_invitation_id: string; p_token: string }
        Returns: Json
      }
      mark_confirmation_prompt_failed: {
        Args: { p_booking_id: string; p_error?: string }
        Returns: undefined
      }
      mark_confirmation_prompt_sent: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      mark_gardener_finished: { Args: { p_booking_id: string }; Returns: Json }
      my_busy_hours: {
        Args: { p_end: string; p_start: string }
        Returns: {
          date: string
          hour: number
          status: string
        }[]
      }
      my_company_id: { Args: never; Returns: string }
      my_company_membership: { Args: never; Returns: Json }
      my_jobs: {
        Args: { p_from: string; p_to: string }
        Returns: {
          assignment_pending: boolean
          booking_id: string
          client_address: string
          client_name: string
          client_phone: string
          company_name: string
          date: string
          duration_hours: number
          end_date: string
          finished_at: string
          labour_hours: number
          my_days: Json
          my_hours: number[]
          notes: string
          service_name: string
          service_start: string
          start_time: string
          status: string
          team_size: number
        }[]
      }
      pick_provider_worker: {
        Args: {
          p_date: string
          p_end_hour: number
          p_provider: string
          p_requires_license?: boolean
          p_service: string
          p_start_hour: number
        }
        Returns: string
      }
      pick_provider_workers_by_hour: {
        Args: {
          p_date: string
          p_end_hour: number
          p_provider: string
          p_requires_license?: boolean
          p_service: string
          p_start_hour: number
        }
        Returns: string[]
      }
      plan_booking_cells: {
        Args: {
          p_date: string
          p_extra_services?: string[]
          p_ignore_booking?: string
          p_labour: number
          p_provider: string
          p_requires_license?: boolean
          p_service: string
          p_start_hour: number
        }
        Returns: {
          date: string
          hour_block: number
          worker_id: string
        }[]
      }
      post_booking_system_message: {
        Args: { p_booking_id: string; p_text: string }
        Returns: undefined
      }
      prepare_booking_payment_attempt: {
        Args: { p_hold_ttl_minutes?: number; p_quote_id: string }
        Returns: Json
      }
      prepare_booking_payment_attempt_for_client: {
        Args: {
          p_client_id: string
          p_hold_ttl_minutes?: number
          p_quote_id: string
        }
        Returns: Json
      }
      propose_booking_price_change: {
        Args: {
          p_booking_id: string
          p_expires_in_minutes?: number
          p_operation_id?: string
          p_proposed_duration_hours?: number
          p_proposed_total_price: number
          p_reason?: string
        }
        Returns: Json
      }
      propose_booking_reschedule: {
        Args: {
          p_booking_id: string
          p_date: string
          p_reason?: string
          p_start_hour: number
        }
        Returns: Json
      }
      provider_allows_split_jobs: {
        Args: { p_provider: string }
        Returns: boolean
      }
      provider_free_hours: {
        Args: {
          p_end: string
          p_exclude_hold_ids?: string[]
          p_extra_service_ids?: string[]
          p_provider_ids: string[]
          p_requires_license?: boolean
          p_service_id: string
          p_start: string
        }
        Returns: {
          date: string
          hour: number
          provider_id: string
          worker_id: string
        }[]
      }
      provider_max_crew: { Args: { p_provider: string }; Returns: number }
      provider_workers: {
        Args: {
          p_provider: string
          p_requires_license?: boolean
          p_service: string
        }
        Returns: string[]
      }
      provider_workers_all: {
        Args: {
          p_provider: string
          p_requires_license?: boolean
          p_services: string[]
        }
        Returns: string[]
      }
      purge_stale_ai_analysis_quota: { Args: never; Returns: number }
      record_incident_money_result: {
        Args: {
          p_incident_id: string
          p_money_status: string
          p_payment_intent_id?: string
        }
        Returns: undefined
      }
      redeem_booking_confirmation_token: {
        Args: { p_ip?: unknown; p_token_hash: string; p_user_agent?: string }
        Returns: Json
      }
      register_booking_batch_operation_once: {
        Args: {
          p_action: string
          p_batch_key: string
          p_operation_id: string
          p_payload_signature: string
        }
        Returns: boolean
      }
      register_booking_operation_once: {
        Args: {
          p_action: string
          p_booking_id: string
          p_operation_id: string
          p_payload_signature: string
        }
        Returns: boolean
      }
      release_booking_payment_attempt: {
        Args: {
          p_attempt_id: string
          p_gateway_payload?: Json
          p_next_status: string
          p_reason?: string
          p_stripe_payment_intent_id?: string
        }
        Returns: Json
      }
      release_booking_schedule: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      replace_booking_worker: {
        Args: { p_booking_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      report_booking_incident: {
        Args: { p_booking_id: string; p_description: string; p_kind: string }
        Returns: Json
      }
      report_booking_no_show: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: Json
      }
      reschedule_options: {
        Args: { p_booking_id: string; p_date: string }
        Returns: number[]
      }
      reserve_booking_schedule: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      resize_booking_schedule: {
        Args: { p_booking_id: string; p_new_duration_hours: number }
        Returns: undefined
      }
      resolve_booking_incident: {
        Args: { p_incident_id: string; p_note?: string; p_outcome: string }
        Returns: Json
      }
      resolve_booking_management_fee: {
        Args: { p_booking_id?: string; p_pricing_context: Json }
        Returns: {
          fee: number
          source: string
        }[]
      }
      respond_booking_price_change: {
        Args: {
          p_accept: boolean
          p_booking_id: string
          p_operation_id?: string
        }
        Returns: Json
      }
      respond_booking_request: {
        Args: {
          p_booking_id: string
          p_operation_id?: string
          p_response: string
        }
        Returns: Json
      }
      respond_booking_reschedule: {
        Args: { p_accept: boolean; p_booking_id: string }
        Returns: Json
      }
      respond_to_incident: {
        Args: { p_incident_id: string; p_response: string }
        Returns: Json
      }
      respond_to_review: {
        Args: { p_response: string; p_review_id: string }
        Returns: Json
      }
      review_gardener_license: {
        Args: { p_expires_at?: string; p_license_id: string; p_status: string }
        Returns: Json
      }
      revoke_company_invitation: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      run_booking_lifecycle_maintenance: { Args: never; Returns: Json }
      safe_numeric: { Args: { p_value: string }; Returns: number }
      set_company_allow_split_jobs: {
        Args: { p_allow: boolean }
        Returns: Json
      }
      set_company_assignment_mode: { Args: { p_mode: string }; Returns: Json }
      set_company_max_crew: { Args: { p_max: number }; Returns: Json }
      set_company_member_services: {
        Args: { p_member_id: string; p_service_ids: string[] }
        Returns: Json
      }
      set_company_owner_works: { Args: { p_works: boolean }; Returns: Json }
      set_incident_in_review: { Args: { p_incident_id: string }; Returns: Json }
      set_review_hidden: {
        Args: { p_hidden: boolean; p_reason?: string; p_review_id: string }
        Returns: Json
      }
      shares_booking_with: { Args: { target_user: string }; Returns: boolean }
      signup_role_from_metadata: { Args: { p_meta: Json }; Returns: string }
      submit_company_application: {
        Args: { p_application_id: string }
        Returns: Json
      }
      update_own_review: {
        Args: { p_comment: string; p_rating: number; p_review_id: string }
        Returns: Json
      }
      worker_free_at: {
        Args: { p_date: string; p_hour: number; p_worker: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

