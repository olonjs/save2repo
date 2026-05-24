import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

type LeadField = {
  label: string;
  value: string;
};

function safeString(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || "-";
  }
  return JSON.stringify(value);
}

function flattenLeadData(data: Record<string, unknown>): LeadField[] {
  return Object.entries(data)
    .slice(0, 20)
    .map(([key, value]) => ({ label: key, value: safeString(value) }));
}

function LeadNotificationEmail(props: {
  tenantName: string;
  correlationId: string;
  leadData: Record<string, unknown>;
  replyTo: string | null;
}) {
  const fields = flattenLeadData(props.leadData);
  const replyHref = props.replyTo ? `mailto:${props.replyTo}` : "mailto:";

  return (
    <Html>
      <Head />
      <Preview>Nuovo lead ricevuto da {props.tenantName}</Preview>
      <Body style={{ backgroundColor: "#0b0d12", color: "#e6e7eb", fontFamily: "Inter, Arial, sans-serif", padding: "24px" }}>
        <Container style={{ backgroundColor: "#131722", border: "1px solid #2a2f3a", borderRadius: "12px", padding: "24px" }}>
          <Section>
            <Link href="https://app.jsonpages.io" style={{ color: "#ffffff", textDecoration: "none", fontSize: "18px", fontWeight: 700 }}>
              JsonPages
            </Link>
            <Text style={{ color: "#9aa3b2", marginTop: "6px", marginBottom: "0" }}>Invisible postman notification</Text>
          </Section>

          <Hr style={{ borderColor: "#2a2f3a", margin: "20px 0" }} />

          <Heading as="h2" style={{ color: "#ffffff", margin: "0 0 12px 0", fontSize: "22px" }}>
            Nuovo lead da {props.tenantName}
          </Heading>
          <Text style={{ color: "#b7bfcc", marginTop: "0", marginBottom: "16px" }}>Correlation ID: {props.correlationId}</Text>

          <Section style={{ border: "1px solid #2a2f3a", borderRadius: "10px", padding: "12px" }}>
            {fields.length === 0 ? (
              <Text style={{ color: "#b7bfcc", margin: 0 }}>Nessun campo lead disponibile.</Text>
            ) : (
              fields.map((field) => (
                <Row key={field.label} style={{ borderBottom: "1px solid #202633", padding: "6px 0" }}>
                  <Text style={{ margin: "0 0 4px 0", color: "#8d98aa", fontSize: "12px", textTransform: "uppercase" }}>{field.label}</Text>
                  <Text style={{ margin: "0 0 10px 0", color: "#eef1f6", fontSize: "14px", wordBreak: "break-word" }}>{field.value}</Text>
                </Row>
              ))
            )}
          </Section>

          <Section style={{ marginTop: "18px" }}>
            <Button
              href={replyHref}
              style={{
                backgroundColor: "#6d5efc",
                color: "#ffffff",
                borderRadius: "8px",
                textDecoration: "none",
                padding: "12px 18px",
                fontWeight: 600,
              }}
            >
              Rispondi ora
            </Button>
          </Section>

          <Hr style={{ borderColor: "#2a2f3a", margin: "20px 0 12px 0" }} />
          <Text style={{ color: "#7f899b", fontSize: "12px", margin: 0 }}>
            JsonPages Cloud - notifica automatica. Se non vuoi riceverla, aggiorna la configurazione forms del tenant.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function renderLeadNotificationEmail(params: {
  tenantName: string;
  correlationId: string;
  leadData: Record<string, unknown>;
  replyTo: string | null;
}): Promise<string> {
  return render(
    <LeadNotificationEmail
      tenantName={params.tenantName}
      correlationId={params.correlationId}
      leadData={params.leadData}
      replyTo={params.replyTo}
    />
  );
}
