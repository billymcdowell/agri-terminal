import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { coerceValue, type ConfigSchema } from "@/lib/config-schema";

type SchemaFormProps = {
  schema: ConfigSchema;
  values: Record<string, unknown>;
  /** Called with each valid change as it is made, so the panel can preview it live. */
  onChange: (key: string, value: string | number | boolean | null) => void;
};

/** Generates a settings form from a panel's JSON schema. */
export function SchemaForm({ schema, values, onChange }: SchemaFormProps) {
  const prefix = useId();
  return (
    <form className="schema-form" onSubmit={(event) => event.preventDefault()}>
      {Object.entries(schema.properties).map(([key, property]) => {
        const id = `${prefix}-${key}`;
        const current = values[key];
        return (
          <div className="schema-field" key={key}>
            {property.type === "boolean" ? (
              <label htmlFor={id} className="schema-check">
                <input id={id} type="checkbox" checked={Boolean(current)} onChange={(event) => onChange(key, coerceValue(property, event.currentTarget.checked))} />
                {property.title}
              </label>
            ) : (
              <>
                <Label htmlFor={id}>{property.title}</Label>
                {property.type === "string" && property.enum ? (
                  <NativeSelect size="sm" id={id} value={String(current ?? "")} onChange={(event) => onChange(key, coerceValue(property, event.currentTarget.value))}>
                    {property.enum.map((option) => <NativeSelectOption key={option} value={option}>{property.enumLabels?.[option] ?? option}</NativeSelectOption>)}
                  </NativeSelect>
                ) : (
                  <Input id={id} type={property.type === "number" ? "number" : "text"} min={property.type === "number" ? property.minimum : undefined} max={property.type === "number" ? property.maximum : undefined} step={property.type === "number" ? property.multipleOf : undefined} value={String(current ?? "")} onChange={(event) => onChange(key, coerceValue(property, event.currentTarget.value))} />
                )}
              </>
            )}
            {property.description && <p className="schema-hint">{property.description}</p>}
          </div>
        );
      })}
    </form>
  );
}
