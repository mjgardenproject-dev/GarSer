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
          booking_id: string | null
          created_at: string | null
          date: string
          hour_block: number
          id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          date: string
          hour_block: number
          id?: string
        }
        Update: {
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
          expired_at: string | null
          failed_at: string | null
          gardener_id: string
          gateway_response: Json
          id: string
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
          expired_at?: string | null
          failed_at?: string | null
          gardener_id: string
          gateway_response?: Json
          id?: string
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
          expired_at?: string | null
          failed_at?: string | null
          gardener_id?: string
          gateway_response?: Json
          id?: string
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
      bookings: {
        Row: {
          buffer_applied: boolean | null
          client_address: string
          client_id: string | null
          client_latitude: number | null
          client_longitude: number | null
          created_at: string | null
          date: string
          duration_hours: number
          end_time: string | null
          gardener_id: string | null
          hourly_rate: number | null
          id: string
          notes: string | null
          price_change_status: string | null
          pricing_context: Json
          proposed_price_at: string | null
          proposed_price_by: string | null
          proposed_price_expires_at: string | null
          proposed_price_reason: string | null
          proposed_total_price: number | null
          provider_latitude: number | null
          provider_longitude: number | null
          request_id: string | null
          service_id: string | null
          start_time: string
          status: string | null
          total_price: number
          travel_fee: number | null
          updated_at: string | null
        }
        Insert: {
          buffer_applied?: boolean | null
          client_address: string
          client_id?: string | null
          client_latitude?: number | null
          client_longitude?: number | null
          created_at?: string | null
          date: string
          duration_hours: number
          end_time?: string | null
          gardener_id?: string | null
          hourly_rate?: number | null
          id?: string
          notes?: string | null
          price_change_status?: string | null
          pricing_context?: Json
          proposed_price_at?: string | null
          proposed_price_by?: string | null
          proposed_price_expires_at?: string | null
          proposed_price_reason?: string | null
          proposed_total_price?: number | null
          provider_latitude?: number | null
          provider_longitude?: number | null
          request_id?: string | null
          service_id?: string | null
          start_time: string
          status?: string | null
          total_price: number
          travel_fee?: number | null
          updated_at?: string | null
        }
        Update: {
          buffer_applied?: boolean | null
          client_address?: string
          client_id?: string | null
          client_latitude?: number | null
          client_longitude?: number | null
          created_at?: string | null
          date?: string
          duration_hours?: number
          end_time?: string | null
          gardener_id?: string | null
          hourly_rate?: number | null
          id?: string
          notes?: string | null
          price_change_status?: string | null
          pricing_context?: Json
          proposed_price_at?: string | null
          proposed_price_by?: string | null
          proposed_price_expires_at?: string | null
          proposed_price_reason?: string | null
          proposed_total_price?: number | null
          provider_latitude?: number | null
          provider_longitude?: number | null
          request_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "gardener_licenses_gardener_id_fkey_profiles"
            columns: ["gardener_id"]
            isOneToOne: false
            referencedRelation: "gardener_profiles"
            referencedColumns: ["user_id"]
          },
        ]
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
          id: string
          rating: number
        }
        Insert: {
          booking_id?: string | null
          client_id?: string | null
          comment?: string | null
          created_at?: string | null
          gardener_id?: string | null
          id?: string
          rating: number
        }
        Update: {
          booking_id?: string | null
          client_id?: string | null
          comment?: string | null
          created_at?: string | null
          gardener_id?: string | null
          id?: string
          rating?: number
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
      [_ in never]: never
    }
    Functions: {
      admin_review_gardener_application: {
        Args: { p_application_id: string; p_comment?: string; p_status: string }
        Returns: undefined
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
      expire_pending_price_change: {
        Args: { p_booking_id: string }
        Returns: boolean
      }
      expire_stale_booking_requests: {
        Args: { p_gardener_id?: string }
        Returns: number
      }
      generate_recurring_slots: {
        Args: { force_regenerate?: boolean; target_gardener_id: string }
        Returns: undefined
      }
      get_booking_payment_attempt_summary: {
        Args: { p_attempt_id: string }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
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
      propose_booking_price_change:
        | {
            Args: {
              p_booking_id: string
              p_proposed_total_price: number
              p_reason?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_booking_id: string
              p_expires_in_minutes?: number
              p_operation_id?: string
              p_proposed_total_price: number
              p_reason?: string
            }
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
      reserve_booking_schedule: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      respond_booking_price_change:
        | {
            Args: { p_accept: boolean; p_booking_id: string }
            Returns: undefined
          }
        | {
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

