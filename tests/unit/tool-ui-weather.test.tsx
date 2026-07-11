import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AgentInteractionRenderer,
  parseToolUiContent,
} from '@/components/tool-ui/agent-interactions';

describe('Tool UI weather rendering', () => {
  it('recognizes the official weather-widget component id without shape guessing', () => {
    const parsed = parseToolUiContent([
      '```tool-ui',
      JSON.stringify({
        type: 'weather-widget',
        location: 'London',
        forecast: [{ day: 'Wed', condition: 'Cloudy', high: 18, low: 11 }],
      }),
      '```',
    ].join('\n'));

    expect(parsed.interactions).toHaveLength(1);
    expect(parsed.interactions[0]).toMatchObject({
      type: 'weather',
      location: 'London',
    });
  });

  it('renders supplied weather data with its condition icon and units', () => {
    const source = [
      'Current conditions:',
      '',
      '```tool-ui',
      JSON.stringify({
        type: 'weather-widget',
        id: 'weather-seattle',
        location: 'Seattle, WA',
        temperature: 52,
        unit: 'fahrenheit',
        condition: 'Light rain',
        icon: 'rain',
        humidity: 84,
        windSpeed: 9,
        windUnit: 'mph',
        forecast: [
          { day: 'Mon', condition: 'Rain', high: 55, low: 46 },
          { day: 'Tue', condition: 'Cloudy', high: 57, low: 45 },
        ],
      }),
      '```',
    ].join('\n');
    const parsed = parseToolUiContent(source);

    render(<AgentInteractionRenderer interactions={parsed.interactions} />);

    expect(screen.getByTestId('chat-tool-ui-weather')).toHaveTextContent('Seattle, WA');
    expect(screen.getByTestId('chat-tool-ui-weather')).toHaveTextContent('52°F');
    expect(screen.getByTestId('chat-tool-ui-weather')).toHaveTextContent('9 mph');
    expect(screen.getByTestId('chat-tool-ui-weather-icon')).toHaveAttribute('data-weather-icon', 'rain');
    expect(parsed.displayText).not.toContain('"windUnit"');
  });
});
