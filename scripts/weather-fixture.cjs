'use strict';
// Deterministic weather for the isolated verification host, never production.
async function fetchWeatherFixture(value) {
  const url=new URL(value);
  if(url.hostname==='geocoding-api.open-meteo.com')return new Response(JSON.stringify({results:[{id:760844,name:'Kraków',country:'Poland',country_code:'PL',admin1:'Lesser Poland',latitude:52.78152,longitude:20.1177,timezone:'Europe/Warsaw'}]}));
  if(url.hostname!=='api.open-meteo.com')throw Error('Unexpected weather fixture destination');
  const hour=Math.floor(Date.now()/3600000)*3600;
  const day=Math.floor(hour/86400)*86400;
  const imperial=url.searchParams.get('temperature_unit')==='fahrenheit';
  return new Response(JSON.stringify({timezone:'Europe/Warsaw',utc_offset_seconds:3600,current:{time:hour,temperature_2m:imperial?50:10,apparent_temperature:imperial?46:8,weather_code:2,is_day:1,relative_humidity_2m:72,wind_speed_10m:12,wind_direction_10m:220,precipitation:0,cloud_cover:40},
    hourly:{time:Array.from({length:24},(_,i)=>hour+i*3600),temperature_2m:Array.from({length:24},(_,i)=>imperial?50+i%6:10+i%6),weather_code:Array(24).fill(2),is_day:Array(24).fill(1),precipitation_probability:Array(24).fill(20)},
    daily:{time:Array.from({length:7},(_,i)=>day+i*86400),temperature_2m_min:Array(7).fill(imperial?39:4),temperature_2m_max:Array(7).fill(imperial?57:14),weather_code:Array(7).fill(2),precipitation_probability_max:Array(7).fill(30),precipitation_sum:Array(7).fill(1),sunrise:Array.from({length:7},(_,i)=>day+i*86400+6*3600),sunset:Array.from({length:7},(_,i)=>day+i*86400+16*3600),wind_speed_10m_max:Array(7).fill(17),uv_index_max:Array(7).fill(2.5)}}));
}
module.exports={fetchWeatherFixture};
